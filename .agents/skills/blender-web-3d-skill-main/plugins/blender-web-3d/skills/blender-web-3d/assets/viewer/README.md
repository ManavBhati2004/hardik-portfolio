# Viewer template

Vite + three r186. Renders any Blender-exported GLB with the AgX pipeline, a procedural
space environment, material-name-driven shader patches, bloom + film finish, adaptive
quality and runtime static batching.

```bash
npm install                 # also copies Draco/Basis decoders into public/
npm run dev                 # http://localhost:5178  (?stats, ?debug, ?quality=eco|balanced|high, ?model=/models/x.glb)
npm run optimize -- raw.glb public/models/model-v001.glb
npm run build
```

`public/models/station.glb` is the demo model built by `../blender/demo_station.py`
(Blender → `export_glb.py` → `optimize-glb.mjs`, 332 KB).
Adapt it to your model through the options of `createViewer()` in `src/viewer.js`.
