/** Presence routing only. Realm configuration cannot award game rewards. */
namespace HubRealms {
  export interface Realm {
    id: string;
    kind: string;
    roomPrefix: string;
    bounds: { horizontal: number; yBands: number[][] };
    zones: { id: string; above: number; below: number }[];
    spawn: number[];
    alwaysOn: boolean;
  }
  export var REALMS: { [id: string]: Realm } = {
    plaza: {
      id: "plaza", kind: "hub", roomPrefix: "hub",
      bounds: { horizontal: 14000, yBands: [[-400, 4000], [-32000, -26000]] },
      zones: [{ id: "plaza", above: -5000, below: Infinity }, { id: "bar", above: -Infinity, below: -25000 }],
      spawn: [0, 178, 4200], alwaysOn: true,
    },
    sandbox: {
      id: "sandbox", kind: "hub_sandbox", roomPrefix: "hub.sandbox",
      bounds: { horizontal: 14000, yBands: [[-400, 4000]] },
      zones: [{ id: "sandbox", above: -Infinity, below: Infinity }],
      spawn: [0, 178, 0], alwaysOn: false,
    },
  };
  export function get(id: string): Realm | null {
    return Object.prototype.hasOwnProperty.call(REALMS, id) ? REALMS[id] : null;
  }
  export function zoneOf(realm: Realm, yCm: number): string {
    for (var i = 0; i < realm.zones.length; i++) {
      var zone = realm.zones[i];
      if (yCm > zone.above && yCm < zone.below) return zone.id;
    }
    return "void";
  }
  export function inBounds(realm: Realm, x: number, y: number, z: number): boolean {
    var max = realm.bounds.horizontal;
    if (x < -max || x > max || z < -max || z > max) return false;
    for (var i = 0; i < realm.bounds.yBands.length; i++) {
      var band = realm.bounds.yBands[i];
      if (y >= band[0] && y <= band[1]) return true;
    }
    return false;
  }
  /** Keep the plaza's exact one-to-four digit room suffix behavior. */
  export function isRoom(room: string): boolean {
    var ids = Object.keys(REALMS);
    for (var i = 0; i < ids.length; i++) {
      var prefix = REALMS[ids[i]].roomPrefix + ".";
      if (room.indexOf(prefix) === 0 && /^[0-9]{1,4}$/.test(room.slice(prefix.length))) return true;
    }
    return false;
  }
}
