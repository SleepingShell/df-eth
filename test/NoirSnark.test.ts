import ethers, { BigNumberish, Contract } from 'ethers';

import { test, beforeAll, describe, expect } from 'vitest';
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
import { SPAWN_PLANET_1, initializers } from './utils/WorldConstants';
import { TestLocation } from './utils/TestLocation';

const toml = parse(readFileSync("darkforest.toml").toString());

const PLANETHASH_KEY = toml["initializers"]["PLANETHASH_KEY"];
const SPACETYPE_KEY = toml["initializers"]["SPACETYPE_KEY"];
const BIOMEBASE_KEY = toml["initializers"]["BIOMEBASE_KEY"];
const PERLIN_LENGTH_SCALE = toml["initializers"]["PERLIN_LENGTH_SCALE"];
const WORLD_RADIUS_MIN = toml["initializers"]["WORLD_RADIUS_MIN"];

const mimc = await buildMimc();

const keyHash = (key: string): string => {
  //let input = bigIntFromKey(key).toString();
  const hash = mimc.multiHash([key]);
  return "0x" + (mimc.F.toString(hash, 16) as string).padStart(64,'0');
}

const keys = generateKeys(2).map(v => bigIntFromKey(v).toString());
const keyHashes = keys.map(keyHash);

describe('NoirSnark', () => {
  let world: DarkForest;

  const provider = ethers.getDefaultProvider('http://127.0.0.1:8545');
  const wallet = new ethers.Wallet(
    ethers.Wallet.fromMnemonic(process.env.DEPLOYER_MNEMONIC as string).privateKey,
    provider
  );

  beforeAll(async () => {
    const CONTRACT_ADDRESS = "0x79D3ACC9009A7617b7E652F2DC1443607bf96f45";
    world = (new ethers.ContractFactory(df.abi, df.bytecode, wallet)).attach(CONTRACT_ADDRESS) as DarkForest;

    await world.addKeys(keyHashes);
  });

  test('Init', async () => {    
    const planet = Object.assign({}, SPAWN_PLANET_1);
    planet.perlin = 13;
    const proof = proveInit(10,20, planet);
    const callArgs = makeInitArgs(proof, planet);
    await world.initializePlayer(...callArgs, { gasLimit: 30000000});
  });

  test('Reveal', async () => {

  });

  test('Move', async () => {

  });

  test('Whitelist', async () => {
    const key = keys[0];
    const hash = keyHashes[0];
    const recipient = wallet.address;

    let callArgs = makeWhitelistArgs(key, recipient);
    const tx = await world.useKey(...callArgs, { gasLimit: 30000000});
    expect((await tx.wait()).status).eq(1);

    callArgs[0][0] = "0x00"
    let trigger = false;
    const tx2 = await world.useKey(...callArgs, { gasLimit: 30000000}).catch(() => trigger = true );
    expect(trigger);
  })
})

const whitelist_folder_path = "../../whitelist";
const initialize_folder_path = "../../init";

function makeInitArgs(
  proof: BytesLike,
  planetLoc: TestLocation,
  spawnRadius: number = WORLD_RADIUS_MIN
): [
    [
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
  return [
    [
      planetLoc.id,
      planetLoc.perlin,
      spawnRadius,
      PLANETHASH_KEY as number,
      SPACETYPE_KEY as number,
      PERLIN_LENGTH_SCALE as number
    ],
    proof
  ]
}

function makeRevealArgs(
  proof: BytesLike,
  planetLoc: TestLocation,
  x: number,
  y: number
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

function makeMoveArgs(
  proof: BytesLike,
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

function makeWhitelistArgs(key: string, recipient: string): [[BigNumberish, BigNumberish], BytesLike] {
  let key_hash = keyHash(key);

  let keyStr = BigInt(key).toString(16);
  keyStr = keyStr.length % 2 != 0 ? '0' + keyStr : keyStr;
  const proof = proveWhitelist('0x'+keyStr, key_hash, recipient);

  return [
    [
      key_hash,
      recipient
      //BigInt(recipient).toString()
    ],
    proof
  ]
}

function proveInit(x: BigNumberish, y: BigNumberish, planetLoc: TestLocation, spawnRadius: number = WORLD_RADIUS_MIN): string {
  const args = stringify(Object.assign({}, {
    commit: '0x'+planetLoc.hex,
    perlin: '0x'+planetLoc.perlin.toString(16).padStart(2, '0'),
    planethash_key: PLANETHASH_KEY as number,
    r: spawnRadius,
    scale: PERLIN_LENGTH_SCALE as number,
    spacetype_key: SPACETYPE_KEY as number,

    point: {
      x: {
        x: '0x'+x.toString(16).padStart(2,'0'),
        is_neg: false
      },
      y: {
        x: '0x'+y.toString(16).padStart(2,'0'),
        is_neg: false
      }
    }
  }));

  const proof = prove(args, initialize_folder_path);
  return "0x" + proof.toString();
}

function proveWhitelist(key: string, key_hash: string, recipient: string): string {
  const obj = Object.assign({}, { key, key_hash, recipient });
  const args = stringify(obj);
  const proof = prove(args, whitelist_folder_path);
  return "0x" + proof.toString()
}

interface AbiHashes {
  [key: string]: string;
}

function prove(proverToml: string, folder: string, testCase: string = "test") {
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