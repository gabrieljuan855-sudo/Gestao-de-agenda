// A foto de uma peça, reduzida no próprio aparelho antes de subir: a câmera
// do celular entrega 3 a 12 MB por foto, e para reconhecer uma roupa (na
// grade do app e pelo Claude) 1024px no lado maior sobram. O envio cai de
// megabytes para uma ou duas centenas de kB.

export const LADO_MAIOR = 1024
const QUALIDADE = 0.82

// As medidas finais, mantendo a proporção. Nunca aumenta uma imagem pequena.
export function medidasReduzidas(largura, altura, max = LADO_MAIOR) {
  if (!(largura > 0) || !(altura > 0)) return null
  const escala = Math.min(1, max / Math.max(largura, altura))
  return { largura: Math.max(1, Math.round(largura * escala)), altura: Math.max(1, Math.round(altura * escala)) }
}

// `from-image` aplica a rotação que a câmera grava no EXIF; sem ela, foto
// tirada com o celular em pé sairia deitada. O <img> é o caminho de quem não
// tem createImageBitmap com essa opção (e já respeita o EXIF sozinho).
async function decodificar(arquivo) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(arquivo, { imageOrientation: 'from-image' })
    } catch {
      // cai no <img>
    }
  }
  const url = URL.createObjectURL(arquivo)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function reduzirImagem(arquivo, { max = LADO_MAIOR } = {}) {
  let imagem
  try {
    imagem = await decodificar(arquivo)
  } catch {
    throw new Error('Este arquivo não abriu como imagem. Use uma foto em JPEG ou PNG.')
  }
  const medidas = medidasReduzidas(imagem.naturalWidth || imagem.width, imagem.naturalHeight || imagem.height, max)
  if (!medidas) throw new Error('Este arquivo não abriu como imagem. Use uma foto em JPEG ou PNG.')
  const tela = document.createElement('canvas')
  tela.width = medidas.largura
  tela.height = medidas.altura
  const ctx = tela.getContext('2d')
  // JPEG não tem transparência: sem o fundo, o vazio de um PNG vira preto.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, medidas.largura, medidas.altura)
  ctx.drawImage(imagem, 0, 0, medidas.largura, medidas.altura)
  imagem.close?.()
  const blob = await new Promise((resolve) => tela.toBlob(resolve, 'image/jpeg', QUALIDADE))
  if (!blob) throw new Error('Não deu para preparar a foto neste navegador.')
  return blob
}
