import * as THREE from 'three'

/**
 * Clone a mesh's geometry as plain Float32 attributes with the mesh's world
 * transform baked in. Needed for GLBs optimised with meshopt quantisation
 * (KHR_mesh_quantization): positions are stored as normalised integers and the
 * real scale lives on the node — components that read only `mesh.geometry`
 * would otherwise get a mis-scaled model.
 */
export function bakeGeometry(mesh: THREE.Mesh, root?: THREE.Object3D): THREE.BufferGeometry {
  ;(root ?? mesh).updateWorldMatrix(true, true)
  const src = mesh.geometry
  const g = new THREE.BufferGeometry()
  for (const name of Object.keys(src.attributes)) {
    const a = src.getAttribute(name) as THREE.BufferAttribute
    const size = a.itemSize
    const out = new Float32Array(a.count * size)
    for (let i = 0; i < a.count; i++) {
      out[i * size] = a.getX(i)
      if (size > 1) out[i * size + 1] = a.getY(i)
      if (size > 2) out[i * size + 2] = a.getZ(i)
      if (size > 3) out[i * size + 3] = a.getW(i)
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, size))
  }
  if (src.index) g.setIndex(src.index.clone())
  for (const grp of src.groups) g.addGroup(grp.start, grp.count, grp.materialIndex)
  // bake the node transform relative to the given root (or the world)
  const m = new THREE.Matrix4()
  if (root) {
    m.copy(root.matrixWorld).invert().multiply(mesh.matrixWorld)
  } else {
    m.copy(mesh.matrixWorld)
  }
  g.applyMatrix4(m)
  return g
}
