import { Component } from 'react'

// Sem isto, um erro de JavaScript dentro de uma visão (Dia/Semana/Mês) virava
// tela em branco sem pista nenhuma — nem no navegador de quem usa, nem aqui:
// "a aba não carrega" é o relato inteiro que dá para fazer sobre uma tela
// branca. Com a mensagem do erro à vista, o próprio sintoma já aponta a causa.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { erro: null }
  }

  static getDerivedStateFromError(erro) {
    return { erro }
  }

  componentDidCatch(erro, info) {
    console.error('Erro ao renderizar a visão:', erro, info)
  }

  render() {
    if (this.state.erro) {
      return (
        <div className="banner banner--error">
          <span className="banner-icon">✕</span>
          <span className="banner-text">
            Essa parte da tela quebrou: {this.state.erro.message}
          </span>
        </div>
      )
    }
    return this.props.children
  }
}
