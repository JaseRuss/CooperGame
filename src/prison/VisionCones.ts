import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Guard, Guards } from './Guards';
import { SNEAK_REACH } from './Guards';
import { WALLS_ONLY } from './groups';

/** How many slices each cone is cut into (each is a ray, so the cone stops at walls and crates). */
const SLICES = 16;
/** Guards further than this from the camera don't draw (or cast) their cones. */
const DRAW_RANGE = 90;
const HEIGHT = 0.07;
/** Where along the cone the bright inner part ends: the reach while sneaking. */
const INNER = SNEAK_REACH;

const COLORS = {
  calm: new THREE.Color(0xfff0c0),
  suspicious: new THREE.Color(0xffc040),
  searching: new THREE.Color(0xff9a3a),
  alarmed: new THREE.Color(0xff3028),
};

/** Vertex layout: the guard's feet, then an inner and an outer ring of SLICES + 1 points each. */
const VERTS = 1 + 2 * (SLICES + 1);

interface Cone {
  mesh: THREE.Mesh;
  position: THREE.BufferAttribute;
  material: THREE.MeshBasicMaterial;
  marker: THREE.Sprite;
  markerMaterial: THREE.SpriteMaterial;
}

function markerTexture(text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.font = '900 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, 32, 34);
  ctx.fillStyle = color;
  ctx.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The guards' vision cones, drawn flat on the ground in front of each one: pale while he's calm,
 * amber as he gets suspicious, red once he's raised the alarm. Each is clipped by the walls and
 * crates in its way, the bright inner part is how far he sees when you creep along, and a "?" or
 * "!" floats over a guard who's on to something.
 */
export class VisionCones {
  readonly group = new THREE.Group();
  private readonly cones = new Map<Guard, Cone>();
  private readonly index: THREE.BufferAttribute;
  private readonly colors: THREE.BufferAttribute;
  private readonly questionTexture = markerTexture('?', '#ffc040');
  private readonly alarmTexture = markerTexture('!', '#ff4a38');
  private readonly origin = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  private readonly geometryIndex: number[] = [];
  private readonly alphas = new Float32Array(VERTS * 4);
  private frame = 0;
  /** Low graphics: cones are refreshed a third as often. */
  private every = 2;

  constructor(private readonly world: RAPIER.World, guards: Guards) {
    // Triangles: a fan from his feet to the inner ring, then a strip out to the outer ring.
    for (let i = 0; i < SLICES; i++) {
      const a = 1 + i;
      const b = 2 + i;
      const c = 1 + SLICES + 1 + i;
      const d = 2 + SLICES + 1 + i;
      this.geometryIndex.push(0, a, b, a, c, b, b, c, d);
    }
    this.index = new THREE.BufferAttribute(new Uint16Array(this.geometryIndex), 1);
    // White with alpha: fading from the guard's feet out to nothing at the far edge.
    for (let v = 0; v < VERTS; v++) {
      const alpha = v === 0 ? 0.7 : v <= SLICES + 1 ? 0.46 : 0;
      this.alphas.set([1, 1, 1, alpha], v * 4);
    }
    this.colors = new THREE.BufferAttribute(this.alphas, 4);
    for (const g of guards.list) this.add(g);
  }

  private add(g: Guard): void {
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(new Float32Array(VERTS * 3), 3);
    position.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setAttribute('color', this.colors);
    geometry.setIndex(this.index);
    const material = new THREE.MeshBasicMaterial({
      color: COLORS.calm.clone(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.visible = false;
    const markerMaterial = new THREE.SpriteMaterial({ map: this.questionTexture, transparent: true, depthTest: false, fog: false });
    const marker = new THREE.Sprite(markerMaterial);
    marker.scale.set(0.9, 0.9, 1);
    marker.renderOrder = 11;
    marker.visible = false;
    this.group.add(mesh, marker);
    this.cones.set(g, { mesh, position, material, marker, markerMaterial });
  }

  setLite(lite: boolean): void {
    this.every = lite ? 4 : 2;
  }

  /** Redraws every nearby guard's cone and marker (call once a frame, after the guards have moved). */
  update(camera: THREE.Vector3, time: number): void {
    this.frame++;
    for (const [g, cone] of this.cones) {
      const live = g.state === 'active' && g.root.visible && Math.hypot(g.pos.x - camera.x, g.pos.z - camera.z) < DRAW_RANGE;
      cone.mesh.visible = live;
      const alerted = live && (g.alert !== 'calm' || g.suspicion > 0.3);
      cone.marker.visible = alerted;
      if (!live) continue;
      const tint = g.alert === 'alarmed' ? COLORS.alarmed : g.alert === 'searching' ? COLORS.searching : COLORS.calm.clone().lerp(COLORS.suspicious, Math.min(1, g.suspicion * 1.6));
      cone.material.color.copy(tint);
      if (alerted) {
        const hot = g.alert === 'alarmed';
        cone.markerMaterial.map = hot ? this.alarmTexture : this.questionTexture;
        cone.marker.position.set(g.pos.x, g.pos.y + 2.75 + Math.sin(time * 6) * 0.06, g.pos.z);
        const s = hot ? 1.1 : 0.7 + g.suspicion * 0.4;
        cone.marker.scale.set(s, s, 1);
      }
      // The rays are the expensive part: each cone's refreshed every other frame.
      if ((this.frame + g.leg) % this.every === 0) this.shape(g, cone);
    }
  }

  private shape(g: Guard, cone: Cone): void {
    const reach = g.sight;
    const p = cone.position;
    // A guard up a tower looks down on the ground, so his cone is drawn there.
    const ground = g.fixed && g.pos.y > 2 ? 0 : g.pos.y;
    const y = ground + HEIGHT;
    p.setXYZ(0, g.pos.x, y, g.pos.z);
    this.origin.set(g.pos.x, ground + 0.5, g.pos.z);
    for (let i = 0; i <= SLICES; i++) {
      const a = g.yaw + g.halfFov * (2 * (i / SLICES) - 1);
      this.dir.set(-Math.sin(a), 0, -Math.cos(a));
      this.ray.origin = this.origin;
      this.ray.dir = this.dir;
      const hit = this.world.castRay(this.ray, reach, true, undefined, WALLS_ONLY);
      const r = hit ? Math.max(0.3, hit.timeOfImpact - 0.05) : reach;
      const ix = g.pos.x + this.dir.x * r * INNER;
      const iz = g.pos.z + this.dir.z * r * INNER;
      const ox = g.pos.x + this.dir.x * r;
      const oz = g.pos.z + this.dir.z * r;
      p.setXYZ(1 + i, ix, y, iz);
      p.setXYZ(2 + SLICES + i, ox, y, oz);
    }
    p.needsUpdate = true;
  }
}
