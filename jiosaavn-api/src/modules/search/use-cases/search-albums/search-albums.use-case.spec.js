import { SearchAlbumModel } from '../../../search/models/index.js';
import { SearchAlbumsUseCase } from '../../../search/use-cases/index.js';
import { beforeAll, describe, expect, it } from 'vitest';
describe('SearchAlbums', () => {
    let searchAlbumsUseCase;
    beforeAll(() => {
        searchAlbumsUseCase = new SearchAlbumsUseCase();
    });
    it('should search albums by query and return a list of albums', async () => {
        const albums = await searchAlbumsUseCase.execute({ query: 'imagine dragons', limit: 5, page: 1 });
        expect(() => SearchAlbumModel.parse(albums)).not.toThrow();
    });
});
