import { ArtistAlbumModel } from '../../../artists/models/index.js';
import { GetArtistAlbumsUseCase } from '../../../artists/use-cases/index.js';
import { beforeAll, describe, expect, it } from 'vitest';
describe('GetArtistAlbums', () => {
    let getArtistAlbumsUseCase;
    beforeAll(() => {
        getArtistAlbumsUseCase = new GetArtistAlbumsUseCase();
    });
    it('should get artist albums by artist id and return a list of albums', async () => {
        const albums = await getArtistAlbumsUseCase.execute({
            artistId: '1274170',
            page: 1,
            sortBy: 'popularity',
            sortOrder: 'asc'
        });
        expect(() => ArtistAlbumModel.parse(albums)).not.toThrow();
    });
});
