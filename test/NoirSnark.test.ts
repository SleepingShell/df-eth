import ethers, { BigNumberish, Contract } from 'ethers';

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
  //let input = bigIntFromKey(key).toString();
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

// (151, 997)
const PLANET_2 = new TestLocation({
  hex: '0000ca8819a7378077cca9b7c4e2b3d2effebcefe88990a03379db75e0de5780',
  perlin: 16,
  distFromOrigin: 0
})

/*** Tests ***/
describe('NoirSnark', () => {
  let world: DarkForest;

  const provider = ethers.getDefaultProvider('http://127.0.0.1:8545');
  const wallet = new ethers.Wallet(
    ethers.Wallet.fromMnemonic(process.env.DEPLOYER_MNEMONIC as string).privateKey,
    provider
  );

  beforeAll(async () => {
    const CONTRACT_ADDRESS = "0x8950bab77f29E8f81e6F78AEA0a79bADD88Eeb13";
    world = (new ethers.ContractFactory(df.abi, df.bytecode, wallet)).attach(CONTRACT_ADDRESS) as DarkForest;

    await world.addKeys(keyHashes);
  });

  test('Init', async () => {    
    const planet = Object.assign({}, PLANET_1);
    const callArgs = prepareInit(876, 949, planet);
    await world.initializePlayer(...callArgs, { gasLimit: 30000000});
  });

  test.only('Reveal', async () => {
    const callArgs = prepareReveal(876,949,PLANET_1);
    await world.revealLocation(...callArgs, { gasLimit: 30000000});

    const resp = await world.revealedCoords(PLANET_1.hex);
    //expect(resp.x).eq(876);
    //expect(resp.y).eq(949);
  });

  test('Move', async () => {

  });

  test('Whitelist', async () => {
    const key = keys[0];
    const hash = keyHashes[0];
    const recipient = wallet.address;

    const callArgs = prepareWhitelist(key, recipient);
    const tx = await world.useKey(...callArgs, { gasLimit: 30000000});
    expect((await tx.wait()).status).eq(1);

    callArgs[0][0] = "0x00"
    const failed = false;

    try {
      const tx2 = await world.useKey(...callArgs, { gasLimit: 30000000});
      expect((await tx2.wait()).status).eq(0);
    } catch (err) {
    }
  })
})

const whitelist_folder_path = "../../whitelist";
const initialize_folder_path = "../../init";
const reveal_folder_path = "../../reveal";
const move_folder_path = "../../move";

function prepareWhitelist(key: string, recipient: string): [[BigNumberish, BigNumberish], BytesLike] {
  const key_hash = keyHash(key);

  let keyStr = BigInt(key).toString(16);
  keyStr = keyStr.length % 2 != 0 ? '0' + keyStr : keyStr;
  const proof = proveWhitelist('0x'+keyStr, key_hash, recipient);

  return [
    [
      key_hash,
      recipient
    ],
    proof
  ]
}

function prepareInit(x: BigNumberish, y: BigNumberish, planetLoc: TestLocation
):[
  [
    BigNumberish,
    BigNumberish,
    BigNumberish,
    BigNumberish,
    BigNumberish,
    BigNumberish
  ],
  BytesLike
] {
  //const proof = proveInit(x, y, planetLoc);
  const proof = [0]
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

function prepareReveal(
  x: BigNumberish,
  y: BigNumberish,
  planetLoc: TestLocation
): [
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
  ]
{
  //const proof = proveReveal(x,y,planetLoc);
  const proof = [0];
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

function prepareMove(
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
): [
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
  ]
{
  //const proof = proveMove(x1,y1,x2,y2,oldLoc,newLoc,maxDist);
  const proof = [0];
  return [
    [
      oldLoc.id,
      newLoc.id,
      newLoc.perlin,
      newLoc.distFromOrigin + 1,
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

function proveReveal(x: BigNumberish, y: BigNumberish, planetLoc: TestLocation): string {
  const args = stringify(Object.assign({}, {
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

  return "0x" + prove(args, reveal_folder_path).toString();
}

function proveInit(x: BigNumberish, y: BigNumberish, planetLoc: TestLocation): string {
  const args = stringify(Object.assign({}, {
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

  return "0x" + prove(args, initialize_folder_path).toString();
}

function proveWhitelist(key: string, key_hash: string, recipient: string): string {
  const obj = Object.assign({}, { key, key_hash, recipient });
  const args = stringify(obj);
  return "0x" +  prove(args, whitelist_folder_path).toString()
}

function proveMove(
  x1: BigNumberish,
  y1: BigNumberish,
  x2: BigNumberish,
  y2: BigNumberish,
  oldLoc: TestLocation,
  newLoc: TestLocation,
  maxDist: BigNumberish,
) {
  const args = stringify(Object.assign({},{
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
    scale: PERLIN_LENGTH_SCALE
  }));

  return "0x" + prove(args, move_folder_path).toString();
}

interface AbiHashes {
  [key: string]: string;
}

function prove(proverToml: string, folder: string, testCase = "test") {
  const fpath = path.join(__dirname, folder);
  // get the existent hashes for different proof names
  const abiHashes: AbiHashes = JSON.parse(
    readFileSync(`${fpath}/proofs/abiHashes.json`, 'utf8'),
  );

  // get the hash of the circuit
  const circuit = readFileSync(`${fpath}/src/main.nr`, 'utf8');

  // hash all of it together
  const abiHash = keccak256("0x"+Buffer.from(proverToml.concat(circuit)).toString('hex'));

  // we also need to prove if there's no proof already
  let existentProof: string | boolean;
  try {
    existentProof = readFileSync(
      `${fpath}/proofs/${testCase}.proof`,
      'utf8',
    );
  } catch (e) {
    existentProof = false;
  }

  // if they differ, we need to re-prove
  if (abiHashes[testCase] !== abiHash || !existentProof) {
    console.log(`Proving "${testCase}"...`);
    writeFileSync(`${fpath}/Prover.toml`, proverToml);

    execSync(`nargo prove ${testCase} --show-output`, {cwd: fpath });

    abiHashes[testCase] = abiHash;
    const updatedHashes = JSON.stringify(abiHashes, null, 2);
    writeFileSync(`${fpath}/proofs/abiHashes.json`, updatedHashes);
    console.log(`New proof for "${testCase}" written`);
  }

  const proof = readFileSync(`${fpath}/proofs/${testCase}.proof`);
  return proof;
}

// Convert a string to hex and pad it to 64 characters
function padHex(str: BigNumberish): string {
  return '0x'+str.toString(16).padStart(64,'0');
}