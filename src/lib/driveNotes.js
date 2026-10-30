// Anotações guardadas na pasta privada do Drive ("appDataFolder") — um
// espaço que só este app enxerga, que nem aparece no Drive visível do
// usuário. Substitui o que antes era um texto solto no localStorage: aqui
// sincroniza entre aparelhos, porque mora na conta do Google, não no
// navegador de um só.
//
// Tudo cabe num arquivo único (anotacoes.json) com a lista inteira de notas:
// para o volume de anotações de uma pessoa (dezenas, não milhares), isso é
// mais simples e mais barato do que um arquivo por nota — uma leitura e uma
// gravação bastam, em vez de uma chamada por nota toda vez que a lista muda.
import { request } from './googleApi.js'
import { criarArmazemNoDrive } from './driveArquivos.js'

// Continuam sendo importados daqui pelo resto do app.
export { faltaPermissaoDoDrive, driveApiDesativada, motivoDoGoogle } from './driveErros.js'

// O formato dos arquivos mora em driveArquivos.js (o conector do Claude usa o
// mesmo); aqui ele só ganha o `request` do navegador.
export const { loadNotes, saveNotes, loadProjetos, saveProjetos } = criarArmazemNoDrive(request)
