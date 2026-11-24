module Main where

import qualified Data.Map.Strict as M
import Data.List (intercalate)
import System.Environment (getArgs)
import System.IO
import Text.Read (readMaybe)

-- A comunicação com o executor usa campos separados por tabulação e identificadores sem espaços.
-- A tabela Q continua de um episódio para outro. O comando INIT apaga os valores e inicia outra execução.
type QTable = M.Map (String, String) Double
data Learner = Learner { q :: QTable, rng :: Integer, alpha :: Double,
                         gamma :: Double, epsilon :: Double, strategy :: String }

initial :: Learner
initial = Learner M.empty 1 0.1 0.9 0.2 "qlearning"

getQ :: Learner -> String -> String -> Double
getQ l s a = M.findWithDefault 0 (s,a) (q l)

-- A semente permite repetir os sorteios do gerador Park-Miller, sem pacotes externos.
-- A sequência é diferente da produzida por StdGen, usado no simulador anterior.
draw :: Integer -> (Double, Integer)
draw s = let s' = (16807 * s) `mod` 2147483647
         in (fromIntegral (s'-1) / 2147483646, s')

choose :: Learner -> String -> [String] -> (String, String, Learner)
choose l s actions =
  let (u,r1) = draw (rng l)
      (v,r2) = draw r1
      explore = strategy l == "aleatorio" || u < epsilon l
      best = maximum (map (getQ l s) actions)
      candidates = if explore then actions else filter (\a -> getQ l s a == best) actions
      i = min (length candidates-1) (floor (v * fromIntegral (length candidates)))
  in (candidates !! i, if explore then "exploracao" else "explotacao", l {rng=r2})

learn :: Learner -> String -> String -> Double -> String -> [String] -> Bool
      -> (Double,Double,Double,Learner)
learn l s a reward next actions terminal =
  let old = getQ l s a
      future = if terminal || null actions then 0 else maximum (map (getQ l next) actions)
      new = if strategy l == "aleatorio" then old
            else old + alpha l * (reward + gamma l * future - old)
  in (old,future,new,l {q=M.insert (s,a) new (q l)})

split :: Char -> String -> [String]
split sep x = case break (==sep) x of
  (a,[]) -> [a]
  (a,_:b) -> a : split sep b

actionsOf :: String -> [String]
actionsOf "-" = []
actionsOf s = split ',' s

respond :: [String] -> IO ()
respond = putStrLn . intercalate "\t"

loop :: Learner -> IO ()
loop l = do
  eof <- isEOF
  if eof then pure () else do
    line <- getLine
    case split '\t' line of
      ["INIT",seed,as,gs,es,mode]
        | Just seed' <- readMaybe seed
        , Just a <- readMaybe as, Just g <- readMaybe gs, Just e <- readMaybe es
        , a >= 0, a <= 1, g >= 0, g <= 1, e >= 0, e <= 1
        , mode `elem` ["qlearning","aleatorio"] -> do
          respond ["OK"]
          loop (Learner M.empty ((abs seed' `mod` 2147483646)+1) a g e mode)
      ["CHOOSE",s,aa] | aa /= "-", aa /= "" -> do
        let (a,mode,l') = choose l s (actionsOf aa)
        respond ["ACTION",a,mode,show (getQ l s a)]
        loop l'
      ["LEARN",s,a,rs,next,aa,ts]
        | Just reward <- readMaybe rs, ts `elem` ["0","1"] -> do
          let (old,future,new,l') = learn l s a reward next (actionsOf aa) (ts == "1")
          respond ["UPDATED",show old,show future,show new]
          loop l'
      ["DUMP"] -> do
        mapM_ (\((s,a),v) -> respond ["Q",s,a,show v]) (M.toAscList (q l))
        respond ["END"]
        loop l
      ["QUIT"] -> respond ["BYE"]
      _ -> respond ["ERROR","comando_invalido"] >> loop l

selfTest :: IO ()
selfTest = do
  let (_,_,a,l1) = learn initial "s" "a" 100 "t" [] True
      (_,_,b,_) = learn l1 "s" "a" 100 "s" ["a"] False
      (_,future,c,_) = learn l1 "s" "a" 0 "s" ["a"] True
      xs l = take 30 (stream l)
      stream l = let (x,_,l')=choose l "s" ["a","b","c"] in x:stream l'
      (_,_,d,_) = learn (initial {strategy="aleatorio"}) "s" "a" 100 "t" [] True
  if abs(a-10)<1e-9 && abs(b-19.9)<1e-9 && future==0 && abs(c-9)<1e-9
       && xs initial == xs initial && length (filter (=="b") (xs initial)) > 0 && d==0
    then putStrLn "OK: Bellman, terminal, empates, semente e controle aleatorio."
    else ioError (userError "Falha na verificacao do aprendiz.")

main :: IO ()
main = do
  hSetBuffering stdout LineBuffering
  hSetEncoding stdin utf8
  hSetEncoding stdout utf8
  args <- getArgs
  if args == ["--self-test"] then selfTest else loop initial
