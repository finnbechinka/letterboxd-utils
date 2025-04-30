export class ExtensionError extends Error {
    constructor(message: string, public userFriendly?: string) {
        super(message);
        this.name = 'ExtensionError';
    }
}