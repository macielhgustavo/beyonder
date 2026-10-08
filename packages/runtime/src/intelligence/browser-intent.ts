/** Intent is extracted from the objective, independently of its task-type label. */
export function browserIntent(input: string): { navigation: boolean; required: boolean } {
  const text = input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const webTarget = /https?:\/\/|\b(site|website|webpage|web|pagina|page|documentacao|documentation|internet|online)\b/.test(text);
  const navigation = /\b(navegue|navegar|browse|navigate)\b/.test(text) ||
    (webTarget && /\b(abra|abrir|acesse|acessar|visite|visitar|consulte|consultar|leia|ler|open|visit|access|read|look|check|use|using|usando)\b/.test(text));
  const research = webTarget && /\b(pesquise|pesquisar|pesquisa|research|search|find|discover|descubra|encontre|verifique)\b/.test(text);
  return { navigation, required: navigation || research };
}
