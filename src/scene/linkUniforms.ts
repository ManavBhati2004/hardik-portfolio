import type * as THREE from 'three'

/**
 * R3F 9 applies a `uniforms` prop by copying each uniform into a NEW object on the
 * material, so mutating the memoised uniforms in useFrame never reaches the GPU
 * (ambient animation silently freezes). Pass this as the material's ref to make
 * the material share the exact uniforms object the component animates.
 *
 *   <shaderMaterial uniforms={uniforms} ref={linkUniforms(uniforms)} … />
 */
const cache = new WeakMap<object, (m: THREE.ShaderMaterial | null) => void>()

export function linkUniforms(uniforms: Record<string, THREE.IUniform>) {
  let fn = cache.get(uniforms)
  if (!fn) {
    fn = (m) => {
      if (m && m.uniforms !== uniforms) {
        m.uniforms = uniforms
        m.uniformsNeedUpdate = true
      }
    }
    cache.set(uniforms, fn)
  }
  return fn
}
