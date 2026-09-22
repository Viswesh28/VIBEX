import { SearchController } from '../../index.js';
import { SearchAlbumModel, SearchArtistModel, SearchModel, SearchPlaylistModel, SearchSongModel } from '../../search/models/index.js';
import { beforeAll, describe, expect, it } from 'vitest';
describe('SearchController', () => {
    let searchController;
    beforeAll(() => {
        searchController = new SearchController();
        searchController.initRoutes();
    });
    it('search everything', async () => {
        const response = await searchController.controller.request('/search?query=blurryface+twenty+one+pilots');
        const { data } = (await response.json());
        expect(() => SearchModel.omit({ topQuery: true }).parse(data)).not.toThrow();
    });
    it('search songs', async () => {
        const response = await searchController.controller.request('/search/songs?query=believer');
        const { data } = (await response.json());
        expect(() => SearchSongModel.parse(data)).not.toThrow();
    });
    it('search albums', async () => {
        const response = await searchController.controller.request('/search/albums?query=blurryface+twenty+one+pilots');
        const { data } = (await response.json());
        expect(() => SearchAlbumModel.parse(data)).not.toThrow();
    });
    it('search artists', async () => {
        const response = await searchController.controller.request('/search/artists?query=adele');
        const { data } = (await response.json());
        expect(() => SearchArtistModel.parse(data)).not.toThrow();
    });
    it('search playlists', async () => {
        const response = await searchController.controller.request('/search/playlists?query=indie');
        const { data } = (await response.json());
        expect(() => SearchPlaylistModel.parse(data)).not.toThrow();
    });
});
