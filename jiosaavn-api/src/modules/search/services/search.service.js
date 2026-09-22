import { SearchAlbumsUseCase, SearchAllUseCase, SearchArtistsUseCase, SearchPlaylistsUseCase, SearchSongsUseCase } from '../../search/use-cases/index.js';
export class SearchService {
    searchAllUseCase;
    searchSongsUseCase;
    searchAlbumsUseCase;
    searchArtistsUseCase;
    searchPlaylistsUseCase;
    constructor() {
        this.searchAllUseCase = new SearchAllUseCase();
        this.searchSongsUseCase = new SearchSongsUseCase();
        this.searchAlbumsUseCase = new SearchAlbumsUseCase();
        this.searchArtistsUseCase = new SearchArtistsUseCase();
        this.searchPlaylistsUseCase = new SearchPlaylistsUseCase();
    }
    searchAll = (query) => {
        return this.searchAllUseCase.execute(query);
    };
    searchSongs = (args) => {
        return this.searchSongsUseCase.execute(args);
    };
    searchAlbums = (args) => {
        return this.searchAlbumsUseCase.execute(args);
    };
    searchArtists = (args) => {
        return this.searchArtistsUseCase.execute(args);
    };
    searchPlaylists = (args) => {
        return this.searchPlaylistsUseCase.execute(args);
    };
}
