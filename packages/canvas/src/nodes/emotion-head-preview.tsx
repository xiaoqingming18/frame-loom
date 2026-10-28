import { useEffect, useRef, useState } from 'react';
import {
  Box3,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { emotionBlendshapes, type CanvasEmotionPreset } from './image-emotion';

export function EmotionHeadPreview({ preset }: { preset: CanvasEmotionPreset }) {
  const host = useRef<HTMLDivElement>(null);
  const model = useRef<Mesh[]>([]);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const currentPreset = useRef(preset);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const scene = new Scene();
    const styles = getComputedStyle(container);
    scene.background = new Color(styles.getPropertyValue('--muted').trim());
    const camera = new PerspectiveCamera(38, 1, 0.1, 20);
    camera.position.set(0, 0, 4.15);
    const key = new DirectionalLight('#ffffff', 2.3);
    key.position.set(-2, 2.5, 3);
    scene.add(key);
    const fill = new DirectionalLight('#c8d1df', 0.8);
    fill.position.set(2, 1, 2);
    scene.add(fill);
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      // GPU 初始化只能在挂载后尝试，失败时保留工作区并显示降级提示。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus('error');
      return;
    }
    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.append(renderer.domElement);
    let root: import('three').Object3D | undefined;
    let alive = true;
    const resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    });
    resize.observe(container);
    new GLTFLoader().load(
      '/canvas/models/facecap.glb',
      (gltf) => {
        if (!alive) {
          disposeModel(gltf.scene);
          return;
        }
        root = gltf.scene;
        root.traverse((object) => {
          if (!isPreviewMesh(object)) return;
          const oldMaterials = Array.isArray(object.material) ? object.material : [object.material];
          oldMaterials.forEach((material) => material.dispose());
          object.material = new MeshStandardMaterial({
            color: new Color('#aaacae'),
            roughness: 0.9,
          });
          object.castShadow = false;
          if (object.morphTargetDictionary && object.morphTargetInfluences)
            model.current.push(object);
        });
        const bounds = new Box3().setFromObject(root);
        const size = bounds.getSize(new Vector3());
        root.scale.multiplyScalar(2.35 / Math.max(size.y, 0.001));
        root.position.sub(new Box3().setFromObject(root).getCenter(new Vector3()));
        scene.add(root);
        applyPreset(model.current, currentPreset.current);
        renderer.render(scene, camera);
        setStatus('ready');
      },
      undefined,
      () => alive && setStatus('error'),
    );
    return () => {
      alive = false;
      resize.disconnect();
      if (root) {
        disposeModel(root);
        scene.remove(root);
      }
      model.current = [];
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  useEffect(() => {
    currentPreset.current = preset;
    applyPreset(model.current, preset);
    if (rendererRef.current && sceneRef.current && cameraRef.current)
      rendererRef.current.render(sceneRef.current, cameraRef.current);
  }, [preset]);
  return (
    <div
      ref={host}
      className="relative min-h-44 overflow-hidden rounded-sm border bg-muted"
      aria-label={`3D 表情预览：${preset.label}`}
      aria-busy={status === 'loading'}
    >
      {status !== 'ready' && (
        <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
          {status === 'error' ? '3D 预览暂不可用' : '加载 3D 预览…'}
        </span>
      )}
    </div>
  );
}

function applyPreset(meshes: Mesh[], preset: CanvasEmotionPreset) {
  const targets = emotionBlendshapes(preset);
  for (const mesh of meshes) {
    const dictionary = mesh.morphTargetDictionary ?? {};
    const influences = mesh.morphTargetInfluences ?? [];
    for (const [name, index] of Object.entries(dictionary))
      influences[index] = targets[name as keyof typeof targets] ?? 0;
  }
}

function disposeModel(root: import('three').Object3D) {
  root.traverse((object) => {
    if (!isPreviewMesh(object)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
}

function isPreviewMesh(object: import('three').Object3D): object is Mesh {
  return object instanceof Mesh;
}
