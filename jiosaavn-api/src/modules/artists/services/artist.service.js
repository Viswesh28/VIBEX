import { GetArtistAlbumsUseCase, GetArtistByIdUseCase, GetArtistByLinkUseCase, GetArtistSongsUseCase } from '../../artists/use-cases/index.js';
export class ArtistService {
    getArtistByIdUseCase;
    getArtistByLinkUseCase;
    getArtistSongsUseCase;
    getArtistAlbumsUseCase;
    constructor() {
        this.getArtistByIdUseCase = new GetArtistByIdUseCase();
        this.getArtistByLinkUseCase = new GetArtistByLinkUseCase();
        this.getArtistSongsUseCase = new GetArtistSongsUseCase();
        this.getArtistAlbumsUseCase = new GetArtistAlbumsUseCase();
    }
    getArtistById = (args) => {
        return this.getArtistByIdUseCase.execute(args);
    };
    getArtistByLink = (args) => {
        return this.getArtistByLinkUseCase.execute(args);
    };
    getArtistSongs = (args) => {
        return this.getArtistSongsUseCase.execute(args);
    };
    getArtistAlbums = (args) => {
        return this.getArtistAlbumsUseCase.execute(args);
    };
}
