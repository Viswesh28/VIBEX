import { ArtistModel } from '../../../artists/models/index.js';
import { GetArtistByLinkUseCase } from '../../../artists/use-cases/index.js';
import { beforeAll, describe, expect, it } from 'vitest';
describe('GetArtistByLink', () => {
    let getArtistByLinkUseCase;
    beforeAll(() => {
        getArtistByLinkUseCase = new GetArtistByLinkUseCase();
    });
    it('should get artist by link and return an artist', async () => {
        const artist = await getArtistByLinkUseCase.execute({
            token: 'bQVPhRbZO1I_',
            page: 1,
            songCount: 5,
            albumCount: 5,
            sortBy: 'popularity',
            sortOrder: 'asc'
        });
        expect(() => ArtistModel.parse(artist)).not.toThrow();
    });
});
