# Remotion video

<p align="center">
  <a href="https://github.com/remotion-dev/logo">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://github.com/remotion-dev/logo/raw/main/animated-logo-banner-dark.apng">
      <img alt="Animated Remotion Logo" src="https://github.com/remotion-dev/logo/raw/main/animated-logo-banner-light.gif">
    </picture>
  </a>
</p>

Welcome to your Remotion project!

## Commands

**Install Dependencies**

```console
npm i
```

**Start Preview**

```console
npm run dev
```

**Render video**

```console
npx remotion render
```

## Auto Short Pipeline

The repo now includes an automated talking-head short pipeline:

1. Put a source video anywhere in the repo (example: `src/make bank.mp4`)
2. Generate subtitles + scene plan:

```console
npm run auto-short:plan -- --input "src/make bank.mp4"
```

3. Render:

```console
npm run auto-short:render
```

Output file: `out/auto-short/auto-short.mp4`

### Optional: Local LLM refinement

The default planner is heuristic-only.  
To refine cut points and text with an OpenAI-compatible local server:

```console
LLM_BASE_URL=http://127.0.0.1:11434/v1 \
LLM_MODEL=your-local-model \
npm run auto-short:plan -- --input "src/make bank.mp4" --llmMode openai
```

### Optional: Decorative image assets

Drop PNG/JPG/WebP assets in `public/auto-short/assets`.  
The cutaway pages will auto-use them as floating visuals.

**Upgrade Remotion**

```console
npx remotion upgrade
```

## Docs

Get started with Remotion by reading the [fundamentals page](https://www.remotion.dev/docs/the-fundamentals).

## Help

We provide help on our [Discord server](https://discord.gg/6VzzNDwUwV).

## Issues

Found an issue with Remotion? [File an issue here](https://github.com/remotion-dev/remotion/issues/new).

## License

Note that for some entities a company license is needed. [Read the terms here](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md).
