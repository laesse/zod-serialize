await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "browser",
});
await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "browser",
  minify: true,
  naming: "[dir]/[name].min.[ext]",
});
await Bun.build({
  entrypoints: ["./src/index.ts"],
  external: ["zod"],
  outdir: "./dist",
  target: "bun",
  naming: "[dir]/[name].bun.[ext]",
});
