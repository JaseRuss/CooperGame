import { LOOP, northRoad, canyonX } from '../Layout';
import type { FlatZone } from '../MoonTerrain';
import type { WonderDef } from './types';
import { cheese, toaster, jamSandwich, iceCreamVan, alienPicnic } from './food';
import { cowOverMoon, moonRabbit, penguinSlide, snailRace, trafficJam, spaceWhale, dinoNaut, moonYeti, sharkPond, duckPond, dragonHoard } from './critters';
import { bowling, golf, disco, bouncyCastle, buggyCannon, doorBlue, doorRed, bigJump, crateHenge, pyramid } from './funfair';
import { lostSocks, bathTime, livingRoom, upsideDownHouse, washingLine, manInTheMoon, pirateShip, ufoTicket, rainbowEnd, starFishing, zombieAerobics, welcomeArch, echoCanyon, teaBreak } from './oddities';

/** Points along the new roads, for turning each tableau to face the nearest one. */
const ROAD_POINTS: [number, number][] = [
  ...northRoad().slice(5),
  ...Array.from({ length: 120 }, (_, i): [number, number] => [LOOP.x + Math.cos((i / 120) * Math.PI * 2) * LOOP.rx, LOOP.z + Math.sin((i / 120) * Math.PI * 2) * LOOP.rz]),
];

/** The yaw that turns a tableau at (x, z) to face the nearest bit of road. */
function faceRoad(x: number, z: number): number {
  let best = ROAD_POINTS[0];
  let bestD = Infinity;
  for (const p of ROAD_POINTS) {
    const d = Math.hypot(p[0] - x, p[1] - z);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return Math.atan2(best[0] - x, best[1] - z);
}

type Site = Omit<WonderDef, 'yaw'> & { yaw?: number };

const SITES: Site[] = [
  // On the way.
  { id: 'tea', title: "THE ROAD CREW'S TEA BREAK", line: 'They built a whole road. They have earned a cuppa', x: 50, z: -572, r: 16, build: teaBreak },
  { id: 'echo', title: 'ECHO CANYON', line: 'Hello… hello… hello…', x: canyonX(-760) + 11, z: -760, r: 0, find: 30, build: echoCanyon },
  { id: 'welcome', title: 'THE WEIRD SIDE OF THE MOON', line: 'Population: weird. Go and explore!', x: 0, z: -915, yaw: 0, r: 0, find: 26, build: welcomeArch },
  // By the way in.
  { id: 'dragon', title: "THE DRAGON'S HOARD", line: 'A castle dragon came too. Do not wake it up', x: 65, z: -890, r: 16, build: dragonHoard },
  { id: 'house', title: 'THE UPSIDE-DOWN HOUSE', line: 'Low gravity got a bit too low', x: -65, z: -885, r: 12, build: upsideDownHouse },
  { id: 'duck', title: 'THE DUCK POND', line: 'The moat guys are on holiday at last', x: -170, z: -930, r: 16, build: duckPond },
  { id: 'shark', title: 'THE SHARK IN A BIB', line: 'It followed you all the way from the prison. Still hungry', x: 180, z: -920, r: 12, build: sharkPond },
  { id: 'picnic', title: 'PICNIC WITH THE NEIGHBOURS', line: 'They brought jelly. The jelly might be alive', x: -110, z: -950, r: 12, build: alienPicnic },
  { id: 'ufo', title: 'THE UFO GOT A TICKET', line: 'Should have paid for parking', x: 120, z: -945, r: 14, build: ufoTicket },
  // Round the south of the ring road.
  { id: 'socks', title: 'WHERE ALL THE LOST SOCKS GO', line: 'Mystery solved!', x: -235, z: -990, r: 14, build: lostSocks },
  { id: 'bath', title: 'BATH TIME', line: 'No water on the Moon, so he brought his own', x: 235, z: -990, r: 10, build: bathTime },
  { id: 'icecream', title: 'MR MOONWHIPPY', line: 'Ninety-nine flavours. All of them taste of Moon dust', x: -320, z: -995, r: 14, build: iceCreamVan },
  { id: 'rabbit', title: 'THE RABBIT IN THE MOON', line: 'Pounding mochi, just like the old stories say', x: -275, z: -1020, r: 10, build: moonRabbit },
  { id: 'doorBlue', title: 'THE DOOR TO SOMEWHERE ELSE', line: 'Drive through it. Go on!', x: 300, z: -1000, r: 6, build: doorBlue },
  // Inside the ring road.
  { id: 'cheese', title: 'THE MOON IS MADE OF CHEESE', line: 'It was true all along! Somebody fetch the crackers', x: -60, z: -1050, r: 14, build: cheese },
  { id: 'cow', title: 'THE COW JUMPED OVER THE MOON', line: '…and the dish ran away with the spoon!', x: 80, z: -1045, r: 18, build: cowOverMoon },
  { id: 'toaster', title: 'THE GIANT TOASTER', line: 'In Moon gravity, toast takes ages to come down', x: -170, z: -1070, r: 12, build: toaster },
  { id: 'living', title: 'THE LIVING ROOM', line: "Best view in the solar system and they're watching telly", x: 170, z: -1060, r: 12, build: livingRoom },
  { id: 'bowling', title: 'MOON BOWLING', line: 'Drive into the pins! Can you get a strike?', x: -210, z: -1130, r: 24, build: bowling },
  { id: 'pyramid', title: 'THE HUMAN PYRAMID', line: "Ten army men, four armies, nobody sneeze", x: 35, z: -1190, r: 8, build: pyramid },
  { id: 'zombies', title: 'ZOMBIE AEROBICS', line: "They've given up brains. Now it's star jumps", x: -160, z: -1205, r: 14, build: zombieAerobics },
  { id: 'disco', title: 'THE MOON DISCO', line: 'Low gravity, high energy', x: -40, z: -1225, r: 18, build: disco },
  { id: 'henge', title: 'CRATE-HENGE', line: 'An ancient Moon mystery. Or the spare crates', x: 110, z: -1215, r: 16, build: crateHenge },
  // The east.
  { id: 'jump', title: 'THE BIG JUMP', line: 'Zoom arrows, a rainbow ramp and six buses. Go for it!', x: 218, z: -1135, yaw: -Math.PI / 2, r: 22, build: bigJump },
  { id: 'dino', title: 'THE DINO-NAUT', line: "The dinosaurs didn't die out. They moved to the Moon", x: 335, z: -1060, r: 14, build: dinoNaut },
  { id: 'jam', title: 'THE GREAT JAM SANDWICH', line: 'So THAT is where the jam cannon gets its jam', x: 390, z: -1090, r: 12, build: jamSandwich },
  { id: 'penguins', title: 'PENGUINS?!', line: 'They took a wrong turn at the South Pole', x: 360, z: -1165, r: 16, build: penguinSlide },
  { id: 'rainbow', title: 'THE END OF THE RAINBOW', line: 'A pot of gold! Finders keepers', x: 330, z: -1240, yaw: 0, r: 8, find: 28, always: true, build: rainbowEnd },
  { id: 'snails', title: 'THE GREAT SNAIL RACE', line: 'Number 3 has been winning for six hours', x: 300, z: -1290, r: 14, build: snailRace },
  // The north.
  { id: 'pirate', title: 'THE LOST PIRATE SHIP', line: "Arrr! Which way's the sea?", x: 190, z: -1320, r: 20, build: pirateShip },
  { id: 'bouncy', title: 'THE BOUNCY CASTLE', line: 'Drive onto the trampoline. Boing!', x: 110, z: -1340, r: 16, build: bouncyCastle },
  { id: 'stars', title: 'GONE FISHING', line: "He's caught a star!", x: 60, z: -1385, r: 8, build: starFishing },
  { id: 'washing', title: 'THE WASHING LINE', line: 'Those are VERY big pants. Whose are they?', x: -40, z: -1345, r: 10, build: washingLine },
  { id: 'giant', title: 'THE MAN IN THE MOON', line: "Shhh! He's having a lie-in", x: -150, z: -1340, r: 24, find: 46, build: manInTheMoon },
  // The west.
  { id: 'traffic', title: "THE MOON'S WORST TRAFFIC JAM", line: "Nobody's in a hurry. Especially the tortoise", x: -270, z: -1285, r: 22, build: trafficJam },
  { id: 'doorRed', title: 'THE DOOR FROM SOMEWHERE ELSE', line: 'It works both ways!', x: -345, z: -1205, r: 6, build: doorRed },
  { id: 'cannon', title: 'THE HUMAN CANNONBALL', line: 'Buggy cannonball, really. Drive into the funnel!', x: -360, z: -1150, yaw: Math.PI / 2, r: 12, zones: [{ x: -140, z: -1150, r: 13 }], build: buggyCannon },
  { id: 'golf', title: 'MOON GOLF', line: 'Up here a golf ball flies for miles', x: -335, z: -1060, r: 14, build: golf },
  { id: 'yeti', title: 'THE MOON YETI', line: 'Very good at hide and seek. Not', x: -415, z: -1100, r: 6, find: 22, secret: true, build: moonYeti },
  // Up above.
  { id: 'whale', title: 'THE SPACE WHALE', line: 'Nobody knows how it got up there. It seems happy', x: 0, z: -1130, r: 0, find: 70, always: true, build: spaceWhale },
];


/** Every odd thing to find on the Weird Side, each turned to face the road unless it says otherwise. */
export const WONDERS: WonderDef[] = SITES.map((s) => ({ ...s, yaw: s.yaw ?? faceRoad(s.x, s.z) }));

/** Flat ground for each tableau. */
export function wonderZones(): FlatZone[] {
  return WONDERS.flatMap((w) => [...(w.r > 0 ? [{ x: w.x, z: w.z, r: w.r }] : []), ...(w.zones ?? [])]);
}
