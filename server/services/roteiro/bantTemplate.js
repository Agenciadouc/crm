// Modelo BANT (Orcamento, Autoridade, Necessidade, Prazo) usado pelo botao "Comecar com modelo BANT" (spec 3.1).
export const BANT_QUESTIONS = [
  { bant: 'need', text: 'O que você quer resolver com isso, {nome}?', kind: 'options', required: true,
    options: [{ label: 'Tem um problema claro e urgente', points: 15 }, { label: 'Quer melhorar algo que já tem', points: 8 }, { label: 'Só pesquisando', points: 0 }] },
  { bant: 'budget', text: 'Você já tem uma faixa de investimento em mente?', kind: 'options', required: true,
    options: [{ label: 'Sim, dentro do nosso preço', points: 15 }, { label: 'Sim, mas abaixo do nosso preço', points: 5 }, { label: 'Ainda não definiu', points: 0 }] },
  { bant: 'authority', text: 'Além de você, mais alguém participa dessa decisão?', kind: 'options', required: true,
    options: [{ label: 'Decide sozinho(a)', points: 15 }, { label: 'Decide com outra pessoa', points: 8 }, { label: 'Outra pessoa decide', points: 2 }] },
  { bant: 'timeline', text: 'Para quando você precisa disso?', kind: 'options', required: true,
    options: [{ label: 'Até 30 dias', points: 15 }, { label: 'De 1 a 3 meses', points: 8 }, { label: 'Mais de 3 meses / sem prazo', points: 0 }] },
]
