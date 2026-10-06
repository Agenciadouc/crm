import Papa from 'papaparse'
import readXlsxFile, { readSheetNames } from 'read-excel-file'
import { decodeText, uniqueHeaders } from './leadImport.js'

// Le .csv/.xlsx no navegador (spec §3). 1a linha = cabecalho; celulas viram texto.
export async function readSheet(file: File, sheet?: string): Promise<{ sheets: string[]; headers: string[]; data: string[][] }> {
  const name = file.name.toLowerCase()
  const cell = (v: unknown) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v))
  let table: string[][]
  let sheets: string[] = []
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = decodeText(new Uint8Array(await file.arrayBuffer()))
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' })
    table = parsed.data.map(r => r.map(cell))
  } else if (name.endsWith('.xlsx')) {
    sheets = await readSheetNames(file)
    const rows = await readXlsxFile(file, { sheet: sheet || sheets[0] })
    table = rows.map(r => r.map(cell))
  } else {
    throw new Error('Não consegui ler este arquivo. Salve como .xlsx ou .csv e tente de novo.')
  }
  if (!table.length) throw new Error('A planilha está vazia.')
  const width = Math.max(...table.map(r => r.length))
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '')
  return { sheets, headers: uniqueHeaders(pad(table[0])), data: table.slice(1).map(pad) }
}
