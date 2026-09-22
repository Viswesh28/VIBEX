import { SearchArtistModel } from '../../../search/models/index.js';
import { SearchArtistsUseCase } from '../../../search/use-cases/index.js';
import { beforeAll, describe, expect, it } from 'vitest';
describe('SearchArtists', () => {
    let searchArtistsUseCase;
    beforeAll(() => {
        searchArtistsUseCase = new SearchArtistsUseCase();
    });
    it('should search artists by query and return a list of artists', async () => {
        const artists = await searchArtistsUseCase.execute({ query: 'imagine dragons', limit: 5, page: 1 });
        expect(() => SearchArtistModel.parse(artists)).not.toThrow();
    });
});
