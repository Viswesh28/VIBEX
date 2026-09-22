import { AlbumModel } from '../../albums/models/index.js';
import { AlbumController } from '../../index.js';
import { beforeAll, describe, expect, it } from 'vitest';
describe('AlbumController', () => {
    let albumController;
    beforeAll(() => {
        albumController = new AlbumController();
        albumController.initRoutes();
    });
    it('retrieve album by link', async () => {
        const response = await albumController.controller.request('/albums?link=https://www.jiosaavn.com/album/future-nostalgia/ITIyo-GDr7A_');
        const { data } = (await response.json());
        expect(() => AlbumModel.parse(data)).not.toThrow();
    });
    it('retrieve album by id', async () => {
        const response = await albumController.controller.request('/albums?id=23241654');
        const { data } = (await response.json());
        expect(() => AlbumModel.parse(data)).not.toThrow();
    });
});
