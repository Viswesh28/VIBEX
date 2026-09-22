import { SongController } from '../../index.js';
import { SongModel } from '../../songs/models/index.js';
import { beforeAll, describe, expect, it } from 'vitest';
describe('SongController', () => {
    let searchController;
    beforeAll(() => {
        searchController = new SongController();
        searchController.initRoutes();
    });
    it('retrieve songs by link', async () => {
        const response = await searchController.controller.request('/songs?link=https://www.jiosaavn.com/song/houdini/OgwhbhtDRwM');
        const { data } = (await response.json());
        expect(() => SongModel.parse(data[0])).not.toThrow();
    });
    it('retrieve song by ID', async () => {
        const response = await searchController.controller.request('/songs/3IoDK8qI');
        const { data } = (await response.json());
        expect(() => SongModel.parse(data[0])).not.toThrow();
    });
    // it('retrieve song suggestions', async () => {
    //   const response = await searchController.controller.request('/songs/yDeAS8Eh/suggestions?limit=5')
    //   const suggestions = await response.json()
    //   expect(suggestions).toMatchSnapshot()
    // })
});
