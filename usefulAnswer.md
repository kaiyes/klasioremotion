• I’m rechecking the current landscape instead of relying on older defaults. I’ll compare modern Japanese analyzers, datasets, and phrase resources against what you already have so the
  recommendation is based on what exists now, not just legacy NLP tooling.

• You’re right to push back. SudachiPy as a GitHub repo being old is misleading. The current maintained line is Sudachi in Rust plus the newer Python package path, not the archived old re
  po. Source: sudachi.rs (https://github.com/WorksApplications/sudachi.rs), Sudachi main repo (https://github.com/WorksApplications/Sudachi).

  My updated take:

  - Don’t build this around AutoPhrase.
  - Don’t treat SakanaAI collections as the main answer here. Their HF page is mostly models, not Japanese expression lexicons or learner-target corpora. Source: SakanaAI collections
    (https://huggingface.co/SakanaAI/collections)
  - Don’t keep kuromoji as the core analyzer if you want to do this properly.

  What is wrong with kuromoji for your task:

  - it’s fine for a quick first pass
  - but it is weak for normalized form, multi-granularity splitting, and cleaner modern dictionary-backed morphology
  - Sudachi’s own comparison page explicitly positions it ahead of kuromoji on normalization and split flexibility. Source: Sudachi comparison
    (https://github.com/WorksApplications/Sudachi)

  If I were rebuilding this now, I would use:

  1. fugashi + full UniDic for the main corpus pass
     Source: fugashi (https://github.com/polm/fugashi)

  - This is the most pragmatic upgrade.
  - It gives you lemma, reading, POS, conjugation info cleanly.
  - It is still a standard serious option for Japanese NLP.

  2. Sudachi.rs as the second analyzer, not necessarily the only one
     Source: sudachi.rs (https://github.com/WorksApplications/sudachi.rs)

  - Use it where normalization and split modes matter.
  - Good for compounds and variant forms.
  - The old SudachiPy archive is not the whole story.

  3. JMdict with examples as a seed source for expressions
     Sources: EDRDG main (https://www.edrdg.org/wiki/Main_Page.html), jmdict-simplified releases (https://github.com/scriptin/jmdict-simplified/releases), JMdict tags
     (https://jedict.com/HTML/edict_doc.html)

  - This is the big thing you were pointing at.
  - JMdict is not just bare dictionary words.
  - It has expression-level entries via POS like exp, and sense info like idiomatic/proverb/polite/humble.
  - The current releases also include JMdict with examples.
  - So yes, JMdict should absolutely be part of the new pipeline.

  4. Your own subtitle mirror as the main in-domain corpus

  - This is still the best source for “what actually gets said in anime.”
  - ~/projects/kitsunekko-mirror/subtitles/anime_tv is the real goldmine here.

  5. LLMs only for classification and promotion

  - classify a form as:
      - inflection
      - derived lexeme
      - fixed expression
  - score teachability
  - normalize meanings
  - do not use LLMs as the first-pass miner

  What I would build now:

  - lemma pass
      - using fugashi + UniDic
      - find top actual surface forms by lemma and conjugation
  - expression pass
      - mine recurring 2-6 token chunks from subtitles
      - filter with morphology/dependency patterns
      - cross-check against JMdict exp / idiom / proverb style entries
  - promotion pass
      - top 10 per base word
      - split into:
          - top inflections
          - top expressions
      - no family mixing in final shorts

  About HF datasets/models:

  - There are useful Japanese resources there, but I did not find a single “done-for-you anime expression set” that replaces this work.
  - I did find learner-oriented sentence data like WJTSentDiL (https://huggingface.co/datasets/bennexx/WJTSentDiL), and major Japanese model ecosystems like LLM-jp
    (https://llm-jp.nii.ac.jp/en/release/) and SakanaAI’s TinySwallow (https://huggingface.co/SakanaAI/collections), but those are better for evaluation/classification/fine-tuning than for
    directly giving you the expression inventory you want.

  So my actual recommendation now is:

  - keep kuromoji out of the new core pipeline
  - use fugashi + UniDic as the main miner
  - add Sudachi.rs where normalization/splitting helps
  - use JMdict with examples to seed and validate expressions
  - use your subtitle mirror as the frequency source
  - use local LLMs after that, not before

  That is better than my earlier suggestion.

  If you want, next I’ll turn this into the exact 3-pass data design:

  - lemma_forms.json
  - expression_candidates.json
  - promoted_targets.json
