import { CreateSongStationUseCase, GetSongByIdUseCase, GetSongByLinkUseCase, GetSongSuggestionsUseCase } from '../../songs/use-cases/index.js';
export class SongService {
    getSongByIdUseCase;
    getSongByLinkUseCase;
    createSongStationUseCase;
    getSongSuggestionsUseCase;
    constructor() {
        this.getSongByIdUseCase = new GetSongByIdUseCase();
        this.getSongByLinkUseCase = new GetSongByLinkUseCase();
        this.createSongStationUseCase = new CreateSongStationUseCase();
        this.getSongSuggestionsUseCase = new GetSongSuggestionsUseCase();
    }
    getSongByIds = (args) => {
        return this.getSongByIdUseCase.execute(args);
    };
    getSongByLink = (token) => {
        return this.getSongByLinkUseCase.execute(token);
    };
    createSongStation = (songIds) => {
        return this.createSongStationUseCase.execute(songIds);
    };
    getSongSuggestions = (args) => {
        return this.getSongSuggestionsUseCase.execute(args);
    };
}
