export interface ExtensionSettings {
    tmdbApiKey: string;
    selectedProviders?: string[];
    countryCode?: string;
}

export interface TMDBRegion {
    iso_3166_1: string;
    english_name: string;
    native_name: string;
}