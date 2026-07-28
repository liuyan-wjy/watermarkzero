# DEV.to Launch Pack

## Title Options

Preferred:

`I built a browser-only tool to remove visible Gemini watermarks`

Alternatives:

- `How I built a local Gemini watermark remover that keeps images in the browser`
- `Building a narrow AI image tool: removing visible Gemini watermarks locally`

## Tags

Use up to 4 tags:

- `webdev`
- `javascript`
- `showdev`
- `opensource`

If you want a less launch-heavy mix, replace `showdev` with `productivity`.

## Cover Image

Recommended cover image:

`marketing/devto/watermarkzero-devto-cover.png`

## Post Body

```md
I built a small tool called [WatermarkZero](https://watermarkzero.org/) to handle one specific case: the visible Gemini watermark that shows up in the bottom-right corner of supported Gemini-generated images.

Site: https://watermarkzero.org/

Repo: https://github.com/liuyan-wjy/watermarkzero

Most tools I found went in one of three directions:

- they cropped the corner
- they pushed the file through a remote server
- they were vague about what they actually supported

I wanted something narrower and more explicit.

## What WatermarkZero does

WatermarkZero runs in the browser and focuses on the visible Gemini mark only. You upload a JPG, PNG, or WebP image, preview the result, and download the cleaned version without sending the file to a backend.

That constraint shaped the whole project. I was not trying to build a general watermark remover. I wanted a tool with a clear boundary and a workflow that people could understand in a few seconds.

## Why local processing mattered

Image tools often ask you to upload files before they explain anything. That works for some use cases, but it feels wrong for screenshots, drafts, or personal images that you do not want sitting on a third-party server.

So I kept the core flow local:

- image selection happens in the browser
- processing happens in the browser
- downloading happens in the browser

That also forced me to keep the UX honest. If the restoration is weak on a certain image, you see it right away.

## Scope matters more than hype

One thing I tried to avoid was pretending this works on everything.

WatermarkZero is built for:

- the visible Gemini watermark
- supported Gemini-generated images
- cases where you want to keep the full frame instead of cropping the corner

It is not built for:

- hidden watermarking systems like SynthID
- every kind of logo or watermark on the internet
- guaranteed success on every textured corner or gradient-heavy image

That narrower scope made the product better. It also made the copy easier to write, because I did not have to blur the edges.

## What I shipped

The current version includes:

- local browser processing
- before/after examples
- downloadable output
- support for JPG, PNG, and WebP
- a few support pages that explain how it works and where it fails

I also spent time on the boring parts:

- mobile layout
- simple analytics
- Cloudflare deployment
- clear FAQ and privacy pages

## The harder cases

The hardest inputs are the ones you would expect:

- fabric folds
- leaves and plant textures
- soft gradients
- detailed corners where the visible mark overlaps real image detail

Those cases are useful because they tell you whether the result looks restored or just blurred over.

## If you want to try it

The tool is here:

https://watermarkzero.org/

If you test it, I would love to hear where it breaks down. Failure cases are more useful than generic praise on a tool this narrow.
```

## Notes

- This is written as a launch post for DEV.to, not as a long technical deep dive.
- If you want, this can be expanded into a second post focused on implementation details: browser image processing, Cloudflare deployment, analytics, and launch distribution.
