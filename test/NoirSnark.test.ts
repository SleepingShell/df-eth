import ethers, { BigNumberish, Contract } from 'ethers';
//import { prove, gateCount } from '@aztec/bb.js/dest/main';
import { gateCount } from '@aztec/bb.js/dest/main'
import { newBarretenbergApiSync, BarretenbergApiAsync, RawBuffer } from '@aztec/bb.js/dest';

import { test, beforeAll, describe, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { execSync } from 'child_process';

import {stringify} from '@iarna/toml';
import path from 'path';
import { BytesLike, keccak256 } from 'ethers/lib/utils';
import { defaultSnarksWorldFixture } from './utils/TestWorld';

import  df from "../artifacts/hardhat-diamond-abi/DarkForest.sol/DarkForest.json";
import { DarkForest } from '@darkforest_eth/contracts/typechain';

import 'dotenv/config';
import { SPAWN_PLANET_1, initializers } from './utils/WorldConstants';
import { TestLocation } from './utils/TestLocation';

const {
  PLANETHASH_KEY,
  SPACETYPE_KEY,
  BIOMEBASE_KEY,
  PERLIN_LENGTH_SCALE,
  PERLIN_MIRROR_X,
  PERLIN_MIRROR_Y,
} = initializers;

describe('NoirSnark', () => {
  let world: DarkForest;

  const provider = ethers.getDefaultProvider('http://127.0.0.1:8545');
  const wallet = new ethers.Wallet(
    ethers.Wallet.fromMnemonic(process.env.DEPLOYER_MNEMONIC as string).privateKey,
    provider
  );

  beforeAll(() => {
    const CONTRACT_ADDRESS = "0x884e9AF7c4bc2B12B8e0Cc5538926986ccf4E670";
    world = (new ethers.ContractFactory(df.abi, df.bytecode, wallet)).attach(CONTRACT_ADDRESS) as DarkForest;
  });

  test('Whitelist snark', async () => {
    /*
    const api = await newBarretenbergApiSync();

    const path = '../whitelist/target/whitelist.json'
    const b = await api.acirGetCircuitSizes(new RawBuffer(getBytecode(path)));
    console.log(b);
    */
    // The above code can be used when bb.js and Nargo are in sync. Currently the bytecode is compressed differently
    // so this cannot be used...

    let x: WhitelistSNARKArgs = {
      key: "0x1023",
      key_hash: "0x01",
      recipient: "0x02",
    }
    
    const t = stringify(x);
    console.log(t);

    const proof = proveInit(10,20, SPAWN_PLANET_1);
    const callArgs = makeInitArgs(SPAWN_PLANET_1);
    callArgs[1] = proof
    await world.initializePlayer(...callArgs, { gasLimit: 30000000});
    //await world.useKey(...(await makeWhitelistArgs("0x00", wallet.address)));
    //console.log(await world.isWhitelisted(wallet.address));
  })
})

export async function makeWhitelistArgs(key: string, recipient: string):
  Promise<[[BigNumberish, BigNumberish], BytesLike]> {
  return [
    [
      keyHash(key),
      //bigInt(recipient.substring(2),16).toString()
      BigInt(recipient).toString()
    ],
    [0]
  ]
}

export function makeInitArgs(
  planetLoc: TestLocation,
  spawnRadius: number = initializers.WORLD_RADIUS_MIN
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
      115,
      SPACETYPE_KEY,
      PERLIN_LENGTH_SCALE
    ],
    [0]
  ]
}

type WhitelistSNARKArgs = {
  key: string,
  key_hash: string,
  recipient: string
}

const whitelist_folder_path = "../../whitelist";
const initialize_folder_path = "../../init";

interface AbiHashes {
  [key: string]: string;
}

function proveInit(x: BigNumberish, y: BigNumberish, planetLoc: TestLocation, spawnRadius: number = initializers.WORLD_RADIUS_MIN): string {
  const args = stringify(Object.assign({}, {
    commit: '0x'+planetLoc.hex,
    perlin: '0x'+planetLoc.perlin.toString(16).padStart(2, '0'),
    planethash_key: PLANETHASH_KEY,
    r: spawnRadius,
    scale: PERLIN_LENGTH_SCALE,
    spacetype_key: SPACETYPE_KEY,

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

  const proof = prove(args, initialize_folder_path, "test");
  return "0x" + proof.toString();
}

function proveWhitelist(key: string, key_hash: string, recipient: string, test_case: string): string {
  const args = stringify(Object.assign({}, { key, key_hash, recipient }));
  const proof = prove(args, whitelist_folder_path, test_case);
  return "0x" + proof.toString()
}

function prove(proverToml: string, folder: string, testCase: string) {
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


function keyHash(key: string): ethers.ethers.BigNumberish {
  throw new Error('Function not implemented.');
}
/*
function getJsonData(jsonPath: string) {
  const json = readFileSync(jsonPath, 'utf-8');
  const parsed = JSON.parse(json);
  return parsed;
}

function getBytecode(jsonPath: string) {
  const parsed = getJsonData(jsonPath);
  const buffer = Buffer.from(parsed.bytecode, 'base64');
  const decompressed = gunzipSync(buffer);
  return decompressed;
}
*/