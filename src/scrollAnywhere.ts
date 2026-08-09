// Scorri ovunque: se la rotella gira sopra una zona vuota (fuori dall'area degli
// elementi, es. margini laterali nelle tab con contenuto centrato), lo scroll viene
// indirizzato al pannello principale (classe .q-scroll) usato per ultimo.
export function installScrollAnywhere(): void {
  let last: HTMLElement | null = null
  window.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      const t = e.target as HTMLElement | null
      if (!t || !t.closest) return
      // Dentro un pannello scrollabile: comportamento naturale + ricordiamolo
      const sc = t.closest('.q-scroll') as HTMLElement | null
      if (sc) {
        last = sc
        return
      }
      // Fuori da qualsiasi area scrollabile: scrolla l'ultimo pannello usato
      const scroller = last && last.isConnected ? last : document.querySelector('.q-scroll')
      if (scroller && scroller.scrollHeight > scroller.clientHeight + 4) {
        e.preventDefault()
        scroller.scrollTop += e.deltaY
      }
    },
    { passive: false }
  )
}