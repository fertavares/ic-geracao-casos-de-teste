#!/usr/bin/env python3
"""Confere os resultados do artigo usando os arquivos da coleta.

A verificação usa apenas a biblioteca padrão do Python e não abre o navegador.
Os resultados calculados são salvos em outra pasta, preservando os registros
originais de validacao_real.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def carregar(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def linhas(path):
    return [json.loads(x) for x in path.read_text(encoding="utf-8-sig").splitlines() if x.strip()]


def exigir(ok, mensagem):
    if not ok:
        raise ValueError(mensagem)


def igual_num(a, b):
    return math.isclose(a, b, rel_tol=1e-10, abs_tol=1e-9)


def verificar(root):
    report = {"origem": "Registros de 11/11/2026; verificação sem acesso aos sites.",
              "escopo": "Três fluxos com Q-learning, três episódios e semente 20261015.",
              "fluxos": [], "atualizacoes_q_conferidas": 0,
              "limites": [
                  "O recálculo não constitui nova execução de navegador.",
                  "O Chrome exato da coleta não foi preservado.",
                  "A coleta usou teclas nativas em sessão; a versão local usa Playwright.",
                  "As capturas de 23/11 ilustram componentes e não pertencem à coleta de 11/11."]}
    expected = {"menu": ([96, 57, 45], [8, 8, 8], 8, 8, 198),
                "ibge": ([21, 29, 21], [1, 7, 1], 7, 8, 71),
                "banco": ([27, 35, 27], [1, 7, 1], 7, 9, 89)}
    for flow in expected:
        folder = root / "validacao_real" / f"{flow}-qlearning-20261015"
        meta = carregar(folder / "metadados.json")
        result = carregar(folder / "resultado.json")
        model, config = meta["model"], meta["config"]
        definitions = {t["id"]: t for t in model["transicoes"]}
        union, episodes = set(), []
        for epfolder in sorted(folder.glob("episodio-*")):
            ep = carregar(epfolder / "episodio.json")
            inputs = linhas(epfolder / "entradas.jsonl")
            steps = linhas(epfolder / "transicoes.jsonl")
            vector = carregar(epfolder / "vetor_entradas.json")
            exigir([x["key"] for x in inputs] == vector, f"{epfolder.name}: vetor divergente")
            tests = [x for x in inputs if x["phase"] == "teste"]
            exigir(len(tests) == ep["passos"], f"{flow}/{epfolder.name}: contagem de teclas")
            exigir(all(x["executed"] for x in tests), f"{flow}/{epfolder.name}: entrada não executada")
            exigir(len(steps) == len(ep["steps"]), f"{flow}/{epfolder.name}: número de ações")
            covered, state, total_cost = set(), model["inicial"], 0
            for step in steps:
                definition = definitions[step["transition"]]
                exigir(step["from"] == state == definition["from"], f"{flow}: trajetória descontínua")
                exigir(step["action"] == definition["action"], f"{flow}: ação incompatível")
                atendido = step["status"] == "atendido"
                fresh = atendido and step["transition"] not in covered
                exigir(fresh == step["fresh"], f"{flow}: novidade inconsistente")
                exigir(igual_num(step["reward"], (100 if fresh else 0) - step["cost"]),
                       f"{flow}: recompensa inconsistente")
                if atendido:
                    covered.add(step["transition"])
                    exigir(step["to"] == definition["to"], f"{flow}: destino incorreto")
                else:
                    exigir(step["to"] == state, f"{flow}: avanço após falha")
                update = step.get("update")
                if update:
                    calculated = update["old"] + config["alpha"] * (
                        step["reward"] + config["gamma"] * update["future"] - update["old"])
                    exigir(igual_num(calculated, update["new"]), f"{flow}: atualização Q incorreta")
                    report["atualizacoes_q_conferidas"] += 1
                total_cost += step["cost"]
                exigir(total_cost == step["totalInputs"], f"{flow}: custo acumulado")
                state = step["to"]
            exigir(total_cost == len(tests), f"{flow}: custo difere do vetor")
            exigir(covered == set(ep["covered"]), f"{flow}: cobertura declarada divergente")
            percent = round(100 * len(covered) / len(definitions), 2)
            exigir(igual_num(percent, ep["coverage"]), f"{flow}: porcentagem do episódio")
            union.update(covered)
            episodes.append({"episodio": ep["number"], "teclas": len(tests),
                             "confirmadas": sorted(covered), "cobertura": percent,
                             "parada": ep["stop"]})
        exp_keys, exp_covered, exp_union, exp_total, exp_cost = expected[flow]
        exigir([e["teclas"] for e in episodes] == exp_keys, f"{flow}: teclas divergem do artigo")
        exigir([len(e["confirmadas"]) for e in episodes] == exp_covered, f"{flow}: cobertura por episódio")
        exigir(len(union) == exp_union and len(definitions) == exp_total, f"{flow}: cobertura acumulada")
        exigir(sum(e["teclas"] for e in episodes) == exp_cost, f"{flow}: total de teclas")
        exigir(union == set(result["covered"]), f"{flow}: resultado.json divergente")
        differences = []
        for name, old_hash in meta.get("hashes", {}).items():
            p = root / name
            actual = hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
            if actual != old_hash:
                differences.append({"arquivo": name, "hash_coleta": old_hash, "hash_atual": actual})
        replay = carregar(root / "validacao_real" / "reproducoes" / flow / "reproducao" / "resultado.json")
        exigir(replay["status"] == "concluida", f"{flow}: reaplicação histórica não concluída")
        if flow in ["ibge", "banco"]:
            failure = carregar(folder / "caso_falha.json")
            vector = carregar(folder / "vetor_ate_falha.json")
            item = failure["cases"][0]
            exigir([i["key"] for i in item["inputs"] if i["phase"] == "teste"] == vector,
                   f"{flow}: vetor da falha difere do caso")
            exigir(replay["steps"] == len(vector), f"{flow}: número de teclas da reaplicação")
            exigir(replay["falhaFuncional"]["reproduzida"] is True, f"{flow}: falha histórica não reproduzida")
            last = item["steps"][-1]
            failure_data = {"transicao": last["transition"], "teclas": len(vector),
                            "vetor": vector, "esperado": last["expected"],
                            "observado": last["after"], "motivo": last["reason"]}
            if flow == "ibge":
                exigir(vector == ["Tab"] * 19 + ["Enter", "Space"], "IBGE: vetor de 21 teclas")
                exigir(last["after"]["focus"]["bucket"] == "ano2010" and not last["after"]["ibge"]["valor2010"],
                       "IBGE: observação da divergência")
            else:
                exigir(vector == ["Tab"] * 27, "Banco: vetor de 27 teclas")
                exigir(last["after"]["focus"]["bucket"] == "also" and last["after"]["banco"]["view"] == "Line",
                       "Banco: observação da divergência")
                exigir("B09" not in result["attempted"], "Banco: B09 deveria permanecer sem tentativa")
        else:
            failure_data = None
            suite = carregar(folder / "suite.json")
            exigir(suite["cases"][0]["episode"] == 3 and replay["steps"] == 45,
                   "Menu: caso selecionado e reaplicação")
        report["fluxos"].append({"id": flow, "estados": len(model["estados"]),
                                  "transicoes": len(definitions), "confirmadas": sorted(union),
                                  "cobertura_acumulada": round(100 * len(union) / len(definitions), 2),
                                  "teclas_total": exp_cost, "episodios": episodes,
                                  "falha": failure_data, "reaplicacao_historica": replay,
                                  "diferencas_fontes_coleta": differences})
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raiz", type=Path, default=ROOT)
    parser.add_argument("--saida", type=Path, default=ROOT / "resultados_verificados")
    args = parser.parse_args()
    report = verificar(args.raiz.resolve())
    args.saida.mkdir(parents=True, exist_ok=True)
    (args.saida / "verificacao.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (args.saida / "tabela_artigo.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.writer(stream, delimiter=";")
        writer.writerow(["fluxo", "estados", "episodio", "teclas", "transicoes_confirmadas", "transicoes_modelo", "cobertura_episodio", "cobertura_acumulada"])
        for flow in report["fluxos"]:
            for ep in flow["episodios"]:
                writer.writerow([flow["id"], flow["estados"], ep["episodio"], ep["teclas"], len(ep["confirmadas"]), flow["transicoes"], ep["cobertura"], flow["cobertura_acumulada"]])
    for flow in report["fluxos"]:
        print(f"OK: {flow['id']} | {len(flow['confirmadas'])}/{flow['transicoes']} | "
              f"{flow['cobertura_acumulada']}% | {flow['teclas_total']} teclas")
        if flow["diferencas_fontes_coleta"]:
            print(f"  Fontes atuais diferem do piloto reutilizado em {len(flow['diferencas_fontes_coleta'])} arquivos; consultar verificacao.json.")
    print(f"OK: {report['atualizacoes_q_conferidas']} atualizações Q conferidas; três reaplicações históricas concluídas nos registros.")
    print(f"Saída: {args.saida.resolve()}")


if __name__ == "__main__":
    main()
