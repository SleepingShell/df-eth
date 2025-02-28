import ethers, { BigNumber, BigNumberish, Contract } from 'ethers';

import { beforeAll, describe, expect, test } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

import {parse, stringify} from '@iarna/toml';
import path from 'path';
import { BytesLike, keccak256 } from 'ethers/lib/utils';

import { buildMimc7 as buildMimc } from 'circomlibjs';

import  df from "../artifacts/hardhat-diamond-abi/DarkForest.sol/DarkForest.json";
import { DarkForest } from '@darkforest_eth/contracts/typechain';
import { bigIntFromKey, generateKeys } from '@darkforest_eth/whitelist';

import 'dotenv/config';
import { TestLocation } from './utils/TestLocation';

import { BarretenbergBackend } from '@noir-lang/backend_barretenberg';
import { Noir, abi } from '@noir-lang/noir_js';
import circuit_biomebase from "./circuits/biomebase.json";
import circuit_init from "./circuits/init.json";
import circuit_move from "./circuits/move.json";
import circuit_reveal from "./circuits/reveal.json";
import circuit_whitelist from "./circuits/whitelist.json";

/*** DarkForest game configuration ***/
const toml = parse(readFileSync("darkforest.toml").toString());
const initializers = toml["initializers"];
const PLANETHASH_KEY = initializers["PLANETHASH_KEY"];
const SPACETYPE_KEY = initializers["SPACETYPE_KEY"];
const BIOMEBASE_KEY = initializers["BIOMEBASE_KEY"];
const PERLIN_LENGTH_SCALE = initializers["PERLIN_LENGTH_SCALE"];
const WORLD_RADIUS_MIN = initializers["WORLD_RADIUS_MIN"];

/*** Hashing and Whitelist Keys ***/
const mimc = await buildMimc();
const keyHash = (key: string): string => {
  const hash = mimc.multiHash([key]);
  return "0x" + (mimc.F.toString(hash, 16) as string).padStart(64,'0');
}
const keys = generateKeys(2).map(v => bigIntFromKey(v).toString());
const keyHashes = keys.map(keyHash);

/*** Planet definitions ***/
// (876, 949)
const PLANET_1 = new TestLocation({
  hex: '0000802bc4d6d6db6e2c80c476949ab73fdf9a1100d9bed50d4c24ab1e31d003',
  perlin: 16,
  distFromOrigin: 0,
});
const PLANET_1_COORDS = [876,949];

// (151, 997)
const PLANET_2 = new TestLocation({
  hex: '0000ca8819a7378077cca9b7c4e2b3d2effebcefe88990a03379db75e0de5780',
  perlin: 16,
  distFromOrigin: 0
})
const PLANET_2_COORDS = [151, 997];

const SHIP_ID = BigNumber.from('0x8c1af698493b2b10f41a33cc7588f0b17b24c6c1cc6e9688124b667a7fec4c94');

enum CircuitType {
  Biomebase,
  Init,
  Move,
  Reveal,
  Whitelist
}

const circuit_map = {};
circuit_map[CircuitType.Biomebase] = circuit_biomebase;
circuit_map[CircuitType.Init] = circuit_init;
circuit_map[CircuitType.Move] = circuit_move;
circuit_map[CircuitType.Reveal] = circuit_reveal;
circuit_map[CircuitType.Whitelist] = circuit_whitelist;

/*** Tests ***/
describe('NoirSnark', () => {
  let world: DarkForest;

  const provider = ethers.getDefaultProvider('http://127.0.0.1:8545');
  const wallet = new ethers.Wallet(
    ethers.Wallet.fromMnemonic(process.env.DEPLOYER_MNEMONIC as string).privateKey,
    provider
  );

  const increaseBlockchainTime = async (interval = 2*86400) => {
    await provider.send('evm_increaseTime', [interval]);
    await provider.send('evm_mine', []);
  }

  beforeAll(async () => {
    /// @note Usually the address stays this same, but this may need to be updated
    const CONTRACT_ADDRESS = "0x8950bab77f29E8f81e6F78AEA0a79bADD88Eeb13";
    world = (new ethers.ContractFactory(df.abi, df.bytecode, wallet)).attach(CONTRACT_ADDRESS) as DarkForest;

    await world.addKeys(keyHashes, {gasLimit: 30000000});
    if (await world.paused()) {
      await world.unpause({gasLimit: 30000000});
    }
  });

  test.only('Init', async () => {    
    const callArgs = await prepareInit(PLANET_1_COORDS[0], PLANET_1_COORDS[1], PLANET_1);
    await world.initializePlayer(...callArgs, { gasLimit: 30000000});
    let planet = await world.planets(PLANET_1.id);
    expect(planet.owner == wallet.address);
  });

  test('Reveal', async () => {
    const callArgs = await prepareReveal(PLANET_1_COORDS[0], PLANET_1_COORDS[1], PLANET_1);
    await world.revealLocation(...callArgs, { gasLimit: 30000000});

    const resp = await world.revealedCoords(PLANET_1.id);
    expect(resp.x.toNumber()).eq(PLANET_1_COORDS[0]);
    expect(resp.y.toNumber()).eq(PLANET_1_COORDS[1]);
  });

  test('Move', async () => {
    await increaseBlockchainTime();

    // Give spaceship
    await world.adminGiveSpaceShip(PLANET_1.id, wallet.address, 10);

    const callArgs = await prepareMove(
      PLANET_1_COORDS[0],
      PLANET_1_COORDS[1],
      PLANET_2_COORDS[0],
      PLANET_2_COORDS[1],
      PLANET_1,
      PLANET_2,
      1000,
      0,
      0,
      SHIP_ID
    );
    await world.refreshPlanet(PLANET_1.id);
    const tx = await world.move(...callArgs, { gasLimit: 30000000});
    await tx.wait();

    let planet = await world.planets(PLANET_2.id);
    expect(planet.owner == wallet.address);
  }, {timeout: 400000});

  test('Whitelist', async () => {
    const key = keys[0];
    const recipient = wallet.address;

    const callArgs = await prepareWhitelist(key, recipient);
    const tx = await world.useKey(...callArgs, { gasLimit: 30000000});
    expect((await tx.wait()).status).eq(1);

    // Key hash must be valid
    callArgs[0][0] = "0x00"
    try {
      const tx2 = await world.useKey(...callArgs, { gasLimit: 30000000});
      expect((await tx2.wait()).status).eq(0);
    } catch (err) {
    }
  })
})

async function prepareWhitelist(key: string, recipient: string): Promise<[[BigNumberish, BigNumberish], BytesLike]> {
  const key_hash = keyHash(key);

  let keyStr = BigInt(key).toString(16);
  keyStr = keyStr.length % 2 != 0 ? '0' + keyStr : keyStr;
  const proof = await proveWhitelist('0x'+keyStr, key_hash, recipient);

  return [
    [
      key_hash,
      recipient
    ],
    proof
  ]
}

async function prepareInit(x: BigNumberish, y: BigNumberish, planetLoc: TestLocation
):Promise<[
  [
    BigNumberish,
    BigNumberish,
    BigNumberish,
    BigNumberish,
    BigNumberish,
    BigNumberish
  ],
  BytesLike
]> {
  const proof = await proveInit(x, y, planetLoc);
  return [
    [
      planetLoc.id,
      planetLoc.perlin,
      WORLD_RADIUS_MIN,
      PLANETHASH_KEY as number,
      SPACETYPE_KEY as number,
      PERLIN_LENGTH_SCALE as number
    ],
    proof
  ]
}

async function prepareReveal(
  x: BigNumberish,
  y: BigNumberish,
  planetLoc: TestLocation
): Promise<[
    [
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish
    ],
    BytesLike
  ]>
{
  const proof = await proveReveal(x,y,planetLoc);
  return [
    [
      planetLoc.id,
      planetLoc.perlin,
      x.toString(),
      0,
      y.toString(),
      0,
      PLANETHASH_KEY,
      SPACETYPE_KEY,
      PERLIN_LENGTH_SCALE,
    ],
    proof
  ];
}

async function prepareMove(
  x1: BigNumberish,
  y1: BigNumberish,
  x2: BigNumberish,
  y2: BigNumberish,
  oldLoc: TestLocation,
  newLoc: TestLocation,
  maxDist: BigNumberish,
  popMoved: BigNumberish,
  silverMoved: BigNumberish,
  movedArtifactId: BigNumberish = 0,
  abandoning: BigNumberish = 0
): Promise<[
      [
        BigNumberish,
        BigNumberish,
        BigNumberish,
        BigNumberish,
        BigNumberish,
        BigNumberish,
        BigNumberish,
        BigNumberish,
        BigNumberish,
        BigNumberish,
        BigNumberish,
        BigNumberish
      ],
    BytesLike
  ]>
{
  const proof = await proveMove(x1,y1,x2,y2,oldLoc,newLoc,maxDist);
  return [
    [
      oldLoc.id,
      newLoc.id,
      newLoc.perlin,
      //newLoc.distFromOrigin + 1,
      WORLD_RADIUS_MIN,
      maxDist,
      PLANETHASH_KEY,
      SPACETYPE_KEY,
      PERLIN_LENGTH_SCALE,
      popMoved,
      silverMoved,
      movedArtifactId,
      abandoning
    ],
    proof
  ]
}

async function proveReveal(x: BigNumberish, y: BigNumberish, planetLoc: TestLocation): Promise<string> {
  const args = (Object.assign({}, {
    commit: '0x'+planetLoc.hex,
    perlin: padHex(planetLoc.perlin),
    planethash_key: PLANETHASH_KEY,
    scale: PERLIN_LENGTH_SCALE,
    spacetype_key: SPACETYPE_KEY,
    point: {
      x: {
        x: padHex(x),
        is_neg: false
      },
      y: {
        x: padHex(y),
        is_neg: false
      }
    }
  }));

  const proof = await prove(CircuitType.Reveal, args);
  return "0x" + proof;
}

async function proveInit(x: BigNumberish, y: BigNumberish, planetLoc: TestLocation): Promise<string> {
  const args = (Object.assign({}, {
    commit: '0x'+planetLoc.hex,
    perlin: padHex(planetLoc.perlin),
    planethash_key: PLANETHASH_KEY as number,
    r: WORLD_RADIUS_MIN,
    scale: PERLIN_LENGTH_SCALE as number,
    spacetype_key: SPACETYPE_KEY as number,

    point: {
      x: {
        x: padHex(x),
        is_neg: false
      },
      y: {
        x: padHex(y),
        is_neg: false
      }
    }
  }));

  const proof = await prove(CircuitType.Init, args);
  return "0x" + proof;
}

async function proveWhitelist(key: string, key_hash: string, recipient: string): Promise<string> {
  const args = Object.assign({}, { key, key_hash, recipient });
  const proof = await prove(CircuitType.Whitelist, args);
  return "0x" + proof;
}

async function proveMove(
  x1: BigNumberish,
  y1: BigNumberish,
  x2: BigNumberish,
  y2: BigNumberish,
  oldLoc: TestLocation,
  newLoc: TestLocation,
  maxDist: BigNumberish,
) {
  const args = (Object.assign({},{
    from: {
      x: {
        x: padHex(x1),
        is_neg: false
      },
      y: {
        x: padHex(y1),
        is_neg: false
      }
    },
    to: {
      x: {
        x: padHex(x2),
        is_neg: false
      },
      y: {
        x: padHex(y2),
        is_neg: false,
      }
    },

    commit1: '0x'+oldLoc.hex,
    commit2: '0x'+newLoc.hex,
    newPerlin: padHex(newLoc.perlin),

    r: WORLD_RADIUS_MIN,
    planethash_key: PLANETHASH_KEY,
    spacetype_key: SPACETYPE_KEY,
    scale: PERLIN_LENGTH_SCALE,
    max_move: padHex(maxDist)
  }));

  const proof = await prove(CircuitType.Move, args);
  return "0x" + proof;
}

async function prove(circuit_name: CircuitType, args: abi.InputMap): Promise<string> {
  const circuit = circuit_map[circuit_name];
  const backend = new BarretenbergBackend(circuit);
  const noir = new Noir(circuit, backend);

  const proof = await noir.generateFinalProof(args);
  return proof.proof.toString();
}

// Convert a string to hex and pad it to 64 characters
function padHex(str: BigNumberish): string {
  return '0x'+str.toString(16).padStart(64,'0');
}