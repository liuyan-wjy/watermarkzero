@RTK.md

# RTK - Rust Token Killer (Codex CLI)

**Usage**: Token-optimized CLI proxy for shell commands.

## Rule

Always prefix shell commands with `rtk`.

Examples:

```bash
rtk git status
rtk cargo test
rtk npm run build
rtk pytest -q
```

## Meta Commands

```bash
rtk gain
rtk gain --history
rtk proxy <cmd>
```

## Verification

```bash
rtk --version
rtk gain
which rtk
```

## Design Context

### Users

The primary users are Gemini image creators, indie makers, designers, and marketers who need to remove the visible Gemini watermark quickly without uploading private assets to a remote server. They typically arrive with a high-intent task, want immediate proof that the tool works, and care more about speed, trust, and clarity than novelty for its own sake.

### Brand Personality

Current working personality: precise, trustworthy, efficient.

The interface should feel technically credible and calm rather than flashy. The emotional goals are confidence and control: users should feel that the tool is specific, honest about limitations, and fast enough to trust for real work.

### Aesthetic Direction

Use a light-first precision-tool aesthetic.

- clean, bright canvas with strong contrast
- sharp geometry and subtle grid or pixel-repair motifs
- technical but approachable typography
- visual proof over decorative noise
- restrained motion that emphasizes before and after transformation

### Design Principles

- Put the tool in the first screen.
- Prove every major claim visually.
- Treat privacy as a design feature.
- Keep keyword-rich copy readable.
- Prefer mobile clarity over decorative density.

