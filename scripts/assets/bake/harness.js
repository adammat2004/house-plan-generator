import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

/**
 * Runs in headless Chromium (scripts/assets/bake.ts). Draws a normalised
 * model from straight above for the plan, with its back at the top and a
 * soft shadow to the south-east like the plan's drawn furniture, plus a
 * three-quarter preview for review.
 */

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

function renderer(width, height, alpha) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(width, height, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.0;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.setClearColor(0x000000, 0);
  return r;
}

function lightScene(r, size) {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(r);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b2a6, 0.8));
  // Key light from the north-west (the plan's -x, +y, which is three's -X, -Z), high up.
  const sun = new THREE.DirectionalLight(0xfff6ea, 1.7);
  const reach = Math.max(size.x, size.z) + 2;
  sun.position.set(-reach * 0.6, reach * 1.6, -reach * 0.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.01;
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 0.1, far: reach * 4 });
  scene.add(sun);
  return scene;
}

async function load(url) {
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return model;
}

/** Straight down, back (-Z) at the top of the picture, +X to the right: the plan at rotation 0. */
async function sprite(url, { width, depth, height, pxPerM, marginM }) {
  const W = width + 2 * marginM;
  const D = depth + 2 * marginM;
  const px = Math.round(W * pxPerM);
  const py = Math.round(D * pxPerM);
  const r = renderer(px, py, true);
  const scene = lightScene(r, { x: W, z: D });
  const model = await load(url);
  scene.add(model);
  const camera = new THREE.OrthographicCamera(-W / 2, W / 2, D / 2, -D / 2, 0.1, height + 20);
  camera.up.set(0, 0, -1);
  camera.position.set(0, height + 10, 0);
  camera.lookAt(0, 0, 0);
  r.render(scene, camera);
  const colour = r.domElement;

  // The silhouette, for the shadow under it.
  const maskScene = new THREE.Scene();
  const flat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const silhouette = model.clone(true);
  silhouette.traverse((o) => {
    if (o.isMesh) o.material = flat;
  });
  maskScene.add(silhouette);
  const m = renderer(px, py, true);
  m.toneMapping = THREE.NoToneMapping;
  m.render(maskScene, camera);

  const out = document.createElement("canvas");
  out.width = px;
  out.height = py;
  const ctx = out.getContext("2d");
  const shadow = (blurM, offsetM, alpha) => {
    ctx.save();
    ctx.filter = `blur(${Math.max(1, blurM * pxPerM)}px)`;
    ctx.globalAlpha = alpha;
    // South-east is right and down in the picture.
    ctx.drawImage(m.domElement, offsetM * pxPerM, offsetM * pxPerM);
    ctx.restore();
  };
  shadow(0.06, 0.045, 0.32);
  shadow(0.015, 0.01, 0.35);
  ctx.drawImage(colour, 0, 0);
  const data = out.toDataURL("image/png");
  r.dispose();
  m.dispose();
  return data;
}

/** A three-quarter view from the front left, for the review sheet. */
async function preview(url, { width, depth, height }) {
  const px = 640;
  const py = 480;
  const r = renderer(px, py, false);
  r.setClearColor(0xeceae6, 1);
  const scene = lightScene(r, { x: width, z: depth });
  const model = await load(url);
  scene.add(model);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.18 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(35, px / py, 0.05, 100);
  const reach = Math.max(width, depth, height) * 1.9 + 0.6;
  // Front is +Z; the viewer stands front left.
  camera.position.set(-reach * 0.55, reach * 0.55, reach * 0.8);
  camera.lookAt(0, height * 0.4, 0);
  r.render(scene, camera);
  const data = r.domElement.toDataURL("image/png");
  r.dispose();
  return data;
}

window.bake = async (url, dims) => ({ sprite: await sprite(url, dims), preview: await preview(url, dims) });
window.bakeReady = true;
