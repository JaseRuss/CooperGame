export interface InputState {
  /** -1 (reverse) .. 1 (forward) */
  throttle: number;
  /** -1 (turn left) .. 1 (turn right) */
  steer: number;
  /** Left-stick direction relative to the camera: +X right, +Y away from camera. Zero when idle. */
  moveX: number;
  moveY: number;
  /** turret yaw change this frame, radians */
  aimYawDelta: number;
  /** turret/barrel pitch change this frame, radians */
  aimPitchDelta: number;
  firing: boolean;
  cameraTogglePressed: boolean;
  resetPressed: boolean;
  mapTogglePressed: boolean;
  rocketPressed: boolean;
  buddyPressed: boolean;
  usingGamepad: boolean;
  pointerLocked: boolean;
}

const DEADZONE = 0.15;

function applyDeadzone(v: number): number {
  if (Math.abs(v) < DEADZONE) return 0;
  const sign = Math.sign(v);
  return sign * ((Math.abs(v) - DEADZONE) / (1 - DEADZONE));
}

export class InputManager {
  private keys = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private mouseDown = false;
  private cameraKeyLatch = false;
  private gamepadCameraLatch = false;
  private resetKeyLatch = false;
  private gamepadResetLatch = false;
  private pointerLocked = false;

  private mouseSensitivity = 0.0024;
  private gamepadYawSpeed = 2.6; // rad/sec at full deflection
  private gamepadPitchSpeed = 0.9;
  private mapKeyLatch = false;
  private gamepadMapLatch = false;
  private rocketLatch = false;
  private buddyLatch = false;
  private rightMouseDown = false;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    canvas.addEventListener('click', () => {
      if (this.pointerLocked) return;
      // Some embedded browsers refuse pointer lock; aiming still works via controller.
      Promise.resolve(canvas.requestPointerLock()).catch(() => {});
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.rightMouseDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rightMouseDown = false;
    });

    // Prevent the browser context menu from eating right-click (reserved for future use).
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Poll device state and produce a single frame's InputState. Call once per frame. */
  update(dt: number): InputState {
    let throttle = 0;
    let steer = 0;
    let moveX = 0;
    let moveY = 0;
    let aimYawDelta = 0;
    let aimPitchDelta = 0;
    let firing = this.mouseDown || this.keys.has('Space');
    let usingGamepad = false;
    let cameraTogglePressed = false;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) throttle += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) throttle -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) steer += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) steer -= 1;

    const cameraKeyHeld = this.keys.has('KeyC');
    if (cameraKeyHeld && !this.cameraKeyLatch) cameraTogglePressed = true;
    this.cameraKeyLatch = cameraKeyHeld;

    let resetPressed = false;
    const resetKeyHeld = this.keys.has('KeyR');
    if (resetKeyHeld && !this.resetKeyLatch) resetPressed = true;
    this.resetKeyLatch = resetKeyHeld;

    let mapTogglePressed = false;
    const mapKeyHeld = this.keys.has('KeyM');
    if (mapKeyHeld && !this.mapKeyLatch) mapTogglePressed = true;
    this.mapKeyLatch = mapKeyHeld;

    aimYawDelta += this.mouseDX * this.mouseSensitivity;
    aimPitchDelta += this.mouseDY * this.mouseSensitivity;
    this.mouseDX = 0;
    this.mouseDY = 0;

    // Button holds are OR-ed across every connected pad *before* edge detection. Windows often
    // lists extra devices (headsets, duplicate XInput entries); checking each pad against a
    // shared latch let an idle one re-arm it every frame, so a held button toggled repeatedly.
    let camButtonHeld = false;
    let resetButtonHeld = false;
    let mapButtonHeld = false;
    let rocketHeld = this.keys.has('KeyF') || this.rightMouseDown;
    let buddyHeld = this.keys.has('KeyX');

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      const rx = applyDeadzone(pad.axes[2] ?? 0);
      const ry = applyDeadzone(pad.axes[3] ?? 0);

      // Radial deadzone on the left stick so every direction responds evenly.
      const rawX = pad.axes[0] ?? 0;
      const rawY = pad.axes[1] ?? 0;
      const rawLen = Math.hypot(rawX, rawY);
      if (rawLen > DEADZONE) {
        const scaled = Math.min(1, (rawLen - DEADZONE) / (1 - DEADZONE)) / rawLen;
        moveX += rawX * scaled;
        moveY += -rawY * scaled;
        usingGamepad = true;
      }
      if (rx !== 0 || ry !== 0) {
        // Squared response gives fine control near centre and fast traverse at full tilt.
        aimYawDelta += Math.sign(rx) * rx * rx * this.gamepadYawSpeed * dt;
        aimPitchDelta += Math.sign(ry) * ry * ry * this.gamepadPitchSpeed * dt;
        usingGamepad = true;
      }

      const rightTrigger = pad.buttons[7]?.value ?? 0;
      const fireButton = pad.buttons[0]?.pressed ?? false;
      if (rightTrigger > 0.2 || fireButton) {
        firing = true;
        usingGamepad = true;
      }

      camButtonHeld ||= pad.buttons[3]?.pressed ?? false; // Y / Triangle
      resetButtonHeld ||= pad.buttons[8]?.pressed ?? false; // Back / View / Share
      mapButtonHeld ||= pad.buttons[9]?.pressed ?? false; // Start / Menu / Options
      rocketHeld ||= pad.buttons[4]?.pressed ?? false; // LB / L1
      buddyHeld ||= pad.buttons[2]?.pressed ?? false; // X / Square
    }

    const rocketPressed = rocketHeld && !this.rocketLatch;
    this.rocketLatch = rocketHeld;
    const buddyPressed = buddyHeld && !this.buddyLatch;
    this.buddyLatch = buddyHeld;

    if (camButtonHeld && !this.gamepadCameraLatch) cameraTogglePressed = true;
    this.gamepadCameraLatch = camButtonHeld;
    if (resetButtonHeld && !this.gamepadResetLatch) resetPressed = true;
    this.gamepadResetLatch = resetButtonHeld;
    if (mapButtonHeld && !this.gamepadMapLatch) mapTogglePressed = true;
    this.gamepadMapLatch = mapButtonHeld;

    throttle = Math.max(-1, Math.min(1, throttle));
    steer = Math.max(-1, Math.min(1, steer));
    const moveLen = Math.hypot(moveX, moveY);
    if (moveLen > 1) {
      moveX /= moveLen;
      moveY /= moveLen;
    }

    return {
      throttle,
      steer,
      moveX,
      moveY,
      aimYawDelta,
      aimPitchDelta,
      firing,
      cameraTogglePressed,
      resetPressed,
      mapTogglePressed,
      rocketPressed,
      buddyPressed,
      usingGamepad,
      pointerLocked: this.pointerLocked,
    };
  }
}
