import { fixtureLoader, makeInitArgs } from "./utils/TestUtils";
import { defaultSnarksWorldFixture, defaultWorldFixture, World } from "./utils/TestWorld";
import { SPAWN_PLANET_1 } from "./utils/WorldConstants";

describe('NoirSnark', () => {
  let world: World;

  beforeEach('load fixture', async function () {
    world = await fixtureLoader(defaultSnarksWorldFixture);
  });

  it('Initialize snark', async () => {
    await world.user1Core.initializePlayer(...makeInitArgs(SPAWN_PLANET_1));
  })
})