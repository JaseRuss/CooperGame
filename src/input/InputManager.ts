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
  /** Held: the short-range jam cannon (E / left trigger). */
  jamFiring: boolean;
  cameraTogglePressed: boolean;
  resetPressed: boolean;
  mapTogglePressed: boolean;
  rocketPressed: boolean;
  /** A salvo of drunken AA missiles (Q / right bumper). */
  aaPressed: boolean;
  /** Held: creep along quietly (on foot), or lie flat under the tarp (on the raft). Shift / Ctrl, RB or a click of the left stick. */
  sneak: boolean;
  /** Mega jam: a ring of jam all round the tank (X / X button). */
  megaJamPressed: boolean;
  usingGamepad: boolean;
  pointerLocked: boolean;
  /** False once the browser has refused pointer lock; the mouse aims unlocked instead. */
  pointerLockAvailable: boolean;
  /** Menu navigation, one step per press (D-pad / left stick / arrows, A / Enter, B / Esc, X / O). */
  menu: MenuInput;
}

export interface MenuInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
  options: boolean;
}

interface EdgeLatches {
  cameraKey: boolean;
  cameraPad: boolean;
  resetKey: boolean;
  resetPad: boolean;
  mapKey: boolean;
  mapPad: boolean;
  rocket: boolean;
  aa: boolean;
  megaJam: boolean;
  menu: Map<keyof MenuInput, boolean>;
}

const MENU_STICK = 0.6;

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
  private pointerLocked = false;
  /** Set once the browser refuses pointer lock (some embedded browsers do); the mouse then aims unlocked. */
  private pointerLockRefused = false;
  /** Cursor position over the game (0..1 across the window), or null when it's outside. */
  private cursor: { x: number; y: number } | null = null;

  private static readonly MOUSE_SENSITIVITY = 0.0024;
  private static readonly GAMEPAD_YAW_SPEED = 2.6; // rad/sec at full deflection
  private static readonly GAMEPAD_PITCH_SPEED = 0.9;
  private mouseSensitivity = InputManager.MOUSE_SENSITIVITY;
  private gamepadYawSpeed = InputManager.GAMEPAD_YAW_SPEED;
  private gamepadPitchSpeed = InputManager.GAMEPAD_PITCH_SPEED;
  private readonly edgeLatches: Record<1 | 2, EdgeLatches> = {
    1: { cameraKey: false, cameraPad: false, resetKey: false, resetPad: false, mapKey: false, mapPad: false, rocket: false, aa: false, megaJam: false, menu: new Map() },
    2: { cameraKey: false, cameraPad: false, resetKey: false, resetPad: false, mapKey: false, mapPad: false, rocket: false, aa: false, megaJam: false, menu: new Map() },
  };
  private rightMouseDown = false;
  /** Set while the options screen is taking typed text (a buddy's name). */
  textEntry = false;

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
    document.addEventListener('pointerlockerror', () => {
      this.pointerLockRefused = true;
    });

    // Locked: every movement aims. Unlocked: movement over the game still aims, and the cursor's
    // position is kept so holding it near an edge keeps the turret turning.
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked || e.target === canvas) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
      this.cursor = e.target === canvas ? { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight } : null;
    });
    document.addEventListener('mouseleave', () => {
      this.cursor = null;
    });
    window.addEventListener('blur', () => {
      this.cursor = null;
      this.mouseDown = false;
    });
    canvas.style.cursor = 'crosshair';
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

  /** Scales mouse and right-stick turret speed (1 = normal). */
  setAimScale(scale: number): void {
    this.mouseSensitivity = InputManager.MOUSE_SENSITIVITY * scale;
    this.gamepadYawSpeed = InputManager.GAMEPAD_YAW_SPEED * scale;
    this.gamepadPitchSpeed = InputManager.GAMEPAD_PITCH_SPEED * scale;
  }

  /** Turns this frame's held menu buttons into one-shot presses. */
  private menuEdges(held: MenuInput, latch: Map<keyof MenuInput, boolean>): MenuInput {
    const out = { ...held };
    for (const key of Object.keys(held) as (keyof MenuInput)[]) {
      out[key] = held[key] && !latch.get(key);
      latch.set(key, held[key]);
    }
    return out;
  }

  /** Poll device state and produce a single frame's InputState. Call once per frame. */
  update(dt: number, gamepadIndex: number = -2, keyboardPlayer: 1 | 2 = 1, split: 'vertical' | 'horizontal' = 'vertical', otherKeyboardAssigned = false): InputState {
    const latches = this.edgeLatches[keyboardPlayer];
    const keyboardEnabled = gamepadIndex < 0 && gamepadIndex !== -3;
    const hasKey = (code: string): boolean => keyboardEnabled && this.keys.has(code);
    const mouseOwner = this.pointerLocked
      ? keyboardPlayer
      : this.cursor && (split === 'vertical' ? (this.cursor.x >= 0.5 ? 2 : 1) : (this.cursor.y >= 0.5 ? 2 : 1));
    const mouseEnabled = keyboardEnabled && (keyboardPlayer === 1 ? mouseOwner !== 2 : mouseOwner === 2);
    let throttle = 0;
    let steer = 0;
    let moveX = 0;
    let moveY = 0;
    let aimYawDelta = 0;
    let aimPitchDelta = 0;
    let firing = (mouseEnabled && this.mouseDown) || hasKey(keyboardPlayer === 1 ? 'Space' : 'Numpad0');
    let jamFiring = hasKey(keyboardPlayer === 1 ? 'KeyE' : 'Numpad1');
    let usingGamepad = false;
    let cameraTogglePressed = false;

    if (keyboardPlayer === 1 ? hasKey('KeyW') || (!otherKeyboardAssigned && hasKey('ArrowUp')) : hasKey('ArrowUp')) throttle += 1;
    if (keyboardPlayer === 1 ? hasKey('KeyS') || (!otherKeyboardAssigned && hasKey('ArrowDown')) : hasKey('ArrowDown')) throttle -= 1;
    if (keyboardPlayer === 1 ? hasKey('KeyD') || (!otherKeyboardAssigned && hasKey('ArrowRight')) : hasKey('ArrowRight')) steer += 1;
    if (keyboardPlayer === 1 ? hasKey('KeyA') || (!otherKeyboardAssigned && hasKey('ArrowLeft')) : hasKey('ArrowLeft')) steer -= 1;

    const cameraKeyHeld = hasKey(keyboardPlayer === 1 ? 'KeyC' : 'Numpad9');
    if (cameraKeyHeld && !latches.cameraKey) cameraTogglePressed = true;
    latches.cameraKey = cameraKeyHeld;

    let resetPressed = false;
    const resetKeyHeld = hasKey(keyboardPlayer === 1 ? 'KeyR' : 'NumpadDecimal');
    if (resetKeyHeld && !latches.resetKey) resetPressed = true;
    latches.resetKey = resetKeyHeld;

    let mapTogglePressed = false;
    const mapKeyHeld = hasKey(keyboardPlayer === 1 ? 'KeyM' : 'NumpadEnter') && !this.textEntry;
    if (mapKeyHeld && !latches.mapKey) mapTogglePressed = true;
    latches.mapKey = mapKeyHeld;

    if (mouseEnabled) {
      aimYawDelta += this.mouseDX * this.mouseSensitivity;
      aimPitchDelta += this.mouseDY * this.mouseSensitivity;
    }
    // Unlocked mouse: park the cursor near the left or right edge to keep turning.
    if (mouseEnabled && !this.pointerLocked && this.cursor) {
      const edge = 0.07;
      const push = this.cursor.x < edge ? -(edge - this.cursor.x) / edge : this.cursor.x > 1 - edge ? (this.cursor.x - (1 - edge)) / edge : 0;
      aimYawDelta += push * this.gamepadYawSpeed * 0.8 * dt;
    }
    if (mouseEnabled) {
      this.mouseDX = 0;
      this.mouseDY = 0;
    }

    // Button holds are OR-ed across every connected pad *before* edge detection. Windows often
    // lists extra devices (headsets, duplicate XInput entries); checking each pad against a
    // shared latch let an idle one re-arm it every frame, so a held button toggled repeatedly.
    let camButtonHeld = false;
    let resetButtonHeld = false;
    let mapButtonHeld = false;
    let rocketHeld = hasKey(keyboardPlayer === 1 ? 'KeyF' : 'Numpad3') || (mouseEnabled && this.rightMouseDown);
    let aaHeld = hasKey(keyboardPlayer === 1 ? 'KeyQ' : 'Numpad5');
    let megaJamHeld = hasKey(keyboardPlayer === 1 ? 'KeyX' : 'Numpad7');
    let sneak = hasKey('ShiftLeft') || hasKey('ShiftRight') || hasKey('ControlLeft') || hasKey('ControlRight');
    const k = (...codes: string[]) => codes.some(hasKey);
    // While a name is being typed, letters, Space and Backspace are text, not menu moves.
    const typing = this.textEntry;
    const menuHeld: MenuInput = {
      up: typing ? k('ArrowUp') : k('ArrowUp', 'KeyW'),
      down: typing ? k('ArrowDown') : k('ArrowDown', 'KeyS'),
      left: typing ? k('ArrowLeft') : k('ArrowLeft', 'KeyA'),
      right: typing ? k('ArrowRight') : k('ArrowRight', 'KeyD'),
      confirm: typing ? k('Enter') : keyboardPlayer === 1 ? k('Enter', 'Space') : k('Numpad0'),
      back: typing ? k('Escape') : keyboardPlayer === 1 ? k('Escape', 'Backspace') : k('NumpadSubtract'),
      options: typing ? false : keyboardPlayer === 1 ? k('KeyO') : k('NumpadAdd'),
    };

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      if (gamepadIndex === -3) continue;
      if (gamepadIndex >= 0 && pad.index !== gamepadIndex) continue;
      if (gamepadIndex === -1) continue;
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
      if ((pad.buttons[6]?.value ?? 0) > 0.2) {
        jamFiring = true; // LT / L2
        usingGamepad = true;
      }

      camButtonHeld ||= pad.buttons[3]?.pressed ?? false; // Y / Triangle
      resetButtonHeld ||= pad.buttons[8]?.pressed ?? false; // Back / View / Share
      mapButtonHeld ||= pad.buttons[9]?.pressed ?? false; // Start / Menu / Options
      rocketHeld ||= pad.buttons[4]?.pressed ?? false; // LB / L1
      aaHeld ||= pad.buttons[5]?.pressed ?? false; // RB / R1
      megaJamHeld ||= pad.buttons[2]?.pressed ?? false; // X / Square
      sneak ||= (pad.buttons[5]?.pressed ?? false) || (pad.buttons[10]?.pressed ?? false); // RB / R1 or the left stick's click

      const btn = (i: number) => pad.buttons[i]?.pressed ?? false;
      menuHeld.up ||= btn(12) || rawY < -MENU_STICK;
      menuHeld.down ||= btn(13) || rawY > MENU_STICK;
      menuHeld.left ||= btn(14) || rawX < -MENU_STICK;
      menuHeld.right ||= btn(15) || rawX > MENU_STICK;
      menuHeld.confirm ||= btn(0);
      menuHeld.back ||= btn(1);
      menuHeld.options ||= btn(2);
    }

    const rocketPressed = rocketHeld && !latches.rocket;
    latches.rocket = rocketHeld;
    const aaPressed = aaHeld && !latches.aa;
    latches.aa = aaHeld;
    const megaJamPressed = megaJamHeld && !latches.megaJam;
    latches.megaJam = megaJamHeld;

    if (camButtonHeld && !latches.cameraPad) cameraTogglePressed = true;
    latches.cameraPad = camButtonHeld;
    if (resetButtonHeld && !latches.resetPad) resetPressed = true;
    latches.resetPad = resetButtonHeld;
    if (mapButtonHeld && !latches.mapPad) mapTogglePressed = true;
    latches.mapPad = mapButtonHeld;

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
      jamFiring,
      cameraTogglePressed,
      resetPressed,
      mapTogglePressed,
      rocketPressed,
      aaPressed,
      megaJamPressed,
      sneak,
      usingGamepad,
      pointerLocked: this.pointerLocked,
      pointerLockAvailable: !this.pointerLockRefused,
      menu: this.menuEdges(menuHeld, latches.menu),
    };
  }
}
