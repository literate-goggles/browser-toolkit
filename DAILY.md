# Daily

`daily.chebakov.me` supports my morning study routine. This file is the short
source of truth for the features I want on the site.

## General behaviour

- Refresh daily content at 00:00 in the configured site timezone, or on the
  first startup or visit after the date changes.
- Keep persistent history across restarts and avoid previously shown items.
  "On this day" content may naturally repeat each year.
- Make every block self-contained: include the useful content directly and
  treat external links as optional references.
- Prefer a few relevant, high-quality items over long feeds.

## IELTS

Keep the IELTS vocabulary, speaking, and writing tools. They are an important
part of the routine and should remain focused on practical progress.

## On this day

Use the current date to read both the Russian and English Wikipedia date pages,
for example:

- `https://ru.wikipedia.org/wiki/24_июля`
- `https://en.wikipedia.org/wiki/July_24`

Present a concise selection of interesting historical events, holidays, and
people born on that date. Use both languages and include enough context to be
useful without opening Wikipedia.

## ML research

Review the day's notable papers and posts from:

- `https://huggingface.co/papers/`
- `https://huggingface.co/blog`
- `https://www.alphaxiv.org/`

Select work relevant to NLP, generative models, and image generation. Summarise
the problem, the main idea, important results, and why the work matters. Avoid
repeating previously covered research.

## Math and ML problem studio

Prepare three original problems every day for each scheduled subject:
mathematical analysis, linear algebra, Leningrad mathematical circles, deep
learning foundations, statistical learning, pen-and-paper ML, ML system
design, algorithms, ML mathematics, and proof practice.

- Ground each set in a complete legitimate book or author-provided source
  cached by the backend. For a commercial book without a legal full download,
  use its official public material and complete author companion repository.
- Use OpenAI GPT-5.6 Sol with high reasoning effort to create and check a
  warm-up, core, and stretch problem.
- Show a hint, an educational worked solution, and a modified follow-up with
  its own solution. Render all notation with KaTeX.
- Remember prior problem concepts and structures so later days do not repeat
  them.

## Cars

Show no more than three sampled historical or modern car models. For each one,
include a representative image, its era, defining characteristics, and why it
matters in automotive history or the modern market. Remember previously shown
models.

## Russian poetry

Select one short Russian poem or a self-contained excerpt suitable for
memorisation. Include the Russian text, author, title, and a brief note that
helps with meaning or recall. Avoid previously selected poems.
