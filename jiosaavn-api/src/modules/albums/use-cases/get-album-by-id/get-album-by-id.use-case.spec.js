import { AlbumModel } from '../../../albums/models/index.js';
import { GetAlbumByIdUseCase } from '../../../albums/use-cases/index.js';
import { beforeAll, describe, expect, it } from 'vitest';
describe('GetAlbumById', () => {
    let getAlbumByIdUseCase;
    beforeAll(() => {
        getAlbumByIdUseCase = new GetAlbumByIdUseCase();
    });
    it('should get album by id', async () => {
        const album = await getAlbumByIdUseCase.execute('23241654');
        expect(() => AlbumModel.parse(album)).not.toThrow();
    });
    it('should not get album by id for wrong album id', async () => {
        const album = await getAlbumByIdUseCase.execute('random-no-id');
        expect(() => AlbumModel.parse(album)).not.toThrow();
    });
});
