// Substituto de "cloudflare:workers", que só existe no runtime da Cloudflare.
// A biblioteca de OAuth importa daí apenas o WorkerEntrypoint, para um
// instanceof; nos testes (Node) esta classe vazia basta.
export class WorkerEntrypoint {}
export const env = {}
