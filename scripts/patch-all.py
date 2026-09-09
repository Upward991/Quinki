#!/usr/bin/env python3
"""
Patch ALL functions in the compiled JS to connect them to the real sidecar.
Patches: fg (App), jh (FileEditor), Rh (SettingsPanel), ah (Composer), rg (LogPanel)
"""

JS_PATH = 'dist/assets/index-DTnRbIdn.js'

def main():
    with open(JS_PATH, 'r') as f:
        js = f.read()

    original_len = len(js)
    patches = []

    def patch(old, new, label, expected_count=1):
        nonlocal js
        count = js.count(old)
        if count != expected_count:
            print(f"WARNING: '{label}' found {count} times, expected {expected_count}")
            if count == 0:
                print(f"  SKIPPING - string not found!")
                return
        js = js.replace(old, new)
        patches.append((label, count))

    # ================================================================
    # PATCH 1: fg (App component) — session creation + sidebar update
    # ================================================================

    # 1a: chatAgentIds initialization — [] → ['quinki-expert']
    patch('[c,l]=(0,v.useState)([])',
          '[c,l]=(0,v.useState)([`quinki-expert`])',
          '1a: chatAgentIds init')

    # 1b: handleSend — fix sendMessage call signature
    patch('e.sendMessage(t,e.activeSessionId||void 0,c)',
          'e.sendMessage(t,{agentId:c[0],model:u||void 0,thinkingLevel:m})',
          '1b: handleSend')

    # 1c: handleAgentToggle — sync to sidecar via setChatAgents
    patch('w=(0,v.useCallback)(e=>{l(t=>t.includes(e)?t.filter(t=>t!==e):[...t,e])},[])',
          'w=(0,v.useCallback)(t=>{l(n=>{let r=n.includes(t)?n.filter(e=>e!==t):[...n,t];return e.setChatAgents(r),r})},[e])',
          '1c: handleAgentToggle sync')

    # 1d: onModelSelect — add e.setModel (2 occurrences: chat + expert)
    patch('onModelSelect:d,',
          'onModelSelect:t=>{d(t),e.setModel(t)},',
          '1d: onModelSelect sync', 2)

    # 1e: onThinkingChange — add e.setThinkingLevel (2 occurrences: chat + expert)
    patch('onThinkingChange:h,',
          'onThinkingChange:t=>{h(t),e.setThinkingLevel(t)},',
          '1e: onThinkingChange sync', 2)

    # 1f: Add useEffect to sync activeSessionId from sidecar + welcome mode
    patch('(0,v.useEffect)(()=>{document.documentElement.setAttribute(`data-theme`,g)},[])',
          ('(0,v.useEffect)(()=>{document.documentElement.setAttribute(`data-theme`,g)},[]),'
           '(0,v.useEffect)(()=>{e.activeSessionId&&s(e.activeSessionId)},[e.activeSessionId]),'
           '(0,v.useEffect)(()=>{e.activeSessionId?b(!1):(t===`chat`&&b(!0))},[e.activeSessionId,t])'),
          '1f: activeSessionId sync + welcome mode')

    # 1g: Sidebar — add onDeleteSession and onRenameSession
    patch('mn,{sessions:M,activeSessionId:o,onSelectSession:D,onNewSession:O,onToggleFolder:E,onReorder:()=>{},welcomeMode:y}',
          'mn,{sessions:M,activeSessionId:o||e.activeSessionId||"",onSelectSession:D,onNewSession:O,onToggleFolder:E,onReorder:()=>{},welcomeMode:y,onDeleteSession:e.deleteSession,onRenameSession:e.renameSession}',
          '1g: sidebar delete/rename')

    # 1h: LogPanel — pass logs and callbacks
    patch('rg,{activePanel:t,onSelectPanel:j}',
          'rg,{activePanel:t,onSelectPanel:j,logs:e.logs,onLoadLog:e.loadFullLog,onClearLog:e.clearLog}',
          '1h: LogPanel props')

    # ================================================================
    # PATCH 2: jh (File editor) — readAgentFile + writeAgentFile
    # ================================================================

    # 2a+2b: jh function signature + readAgentFile with agentId
    patch('function jh({fileName:e,onClose:t}){let[n,r]=(0,v.useState)(!1),[i,a]=(0,v.useState)(!1),[o,s]=(0,v.useState)(`Loading...`),{call:c}=bh();return(0,v.useEffect)(()=>{s(`Loading...`);if(c){let aid=window.__quinki_agent_id||\'\';c(`readAgentFile`,{id:aid,filePath:e}).then(r=>{if(r?.content)s(r.content)}).catch(()=>s(`Failed to load`))}},[e]),',
          'function jh({agentId:e,fileName:t,onClose:n}){let[r,i]=(0,v.useState)(!1),[a,o]=(0,v.useState)(!1),[s,c]=(0,v.useState)(`Loading...`),{call:l}=bh();(0,v.useEffect)(()=>{c(`Loading...`);if(l&&e)l(`readAgentFile`,{id:e,filePath:t}).then(e=>{if(e?.content)c(e.content);else c(``)})["catch"](()=>c(`Failed to load`))},[e,t]),',
          '2a+2b: jh signature + readAgentFile')

    # 2c: Save button — call writeAgentFile
    patch('onClick:()=>{a(!0),setTimeout(()=>{a(!1),r(!1),t()},500)},disabled:i',
          'onClick:async()=>{if(!l||!e)return;o(!0);try{await l(`writeAgentFile`,{id:e,filePath:t,content:s})}catch(err){console.error(`Failed to save file:`,err)}o(!1),i(!1),n()},disabled:a',
          '2c: jh save writeAgentFile')

    # 2d: Textarea — use value instead of defaultValue (controlled component)
    patch('(0,z.jsx)(`textarea`,{defaultValue:o,onChange:()=>{n||r(!0)},',
          '(0,z.jsx)(`textarea`,{value:s,onChange:e=>{c(e.target.value),r(!0)},',
          '2d: jh textarea controlled')

    # 2e: jh invocation — pass agentId
    patch('jh,{fileName:I,onClose:()=>L(null)}',
          'jh,{agentId:I.agentId,fileName:I.fileName,onClose:()=>L(null)}',
          '2e: jh invocation with agentId')

    # ================================================================
    # PATCH 3: Rh (SettingsPanel) — provider creation + save
    # ================================================================

    # 3a: Add bh() call to Rh for RPC access + new provider name state
    patch('function Rh(e){let[t,n]=(0,v.useState)(e.providers),[r,i]=(0,v.useState)(null),[a,o]=(0,v.useState)(!1),[s,c]=(0,v.useState)(``),',
          'function Rh(e){let{call:rpcCall}=bh(),[t,n]=(0,v.useState)(e.providers),[r,i]=(0,v.useState)(null),[a,o]=(0,v.useState)(!1),[s,c]=(0,v.useState)(``),[np,snp]=(0,v.useState)(``),',
          '3a: Rh bh() + newProvider state')

    # 3b: Fix Save function to call setProvidersConfig
    patch('S=()=>{o(!0),setTimeout(()=>{o(!1),i(`Settings saved.`),setTimeout(()=>i(null),5e3)},500)}',
          'S=()=>{o(!0);if(rpcCall){let cfg={};for(let p of t)cfg[p.id]={api:p.type,enabled:p.enabled,apiKey:p.apiKeyStatus===`configured`?`set`:``};rpcCall(`setProvidersConfig`,{providers:cfg})["catch"](()=>{})}setTimeout(()=>{o(!1),i(`Settings saved.`),setTimeout(()=>i(null),5e3)},500)}',
          '3b: Rh save setProvidersConfig')

    # 3c: Bind provider name input to state
    patch('(0,z.jsx)(`input`,{type:`text`,placeholder:`provider name (e.g. anthropic)`,style:{flex:1,height:`32px`,backgroundColor:`var(--q-bg-elevated)`,border:`1px solid var(--q-border)`,borderRadius:`var(--radius-md)`,color:`var(--q-text)`,fontSize:`14px`,fontFamily:`var(--font-interface)`,padding:`0 12px`,outline:`none`}})',
          '(0,z.jsx)(`input`,{type:`text`,placeholder:`provider name (e.g. anthropic)`,value:np,onChange:e=>snp(e.target.value),style:{flex:1,height:`32px`,backgroundColor:`var(--q-bg-elevated)`,border:`1px solid var(--q-border)`,borderRadius:`var(--radius-md)`,color:`var(--q-text)`,fontSize:`14px`,fontFamily:`var(--font-interface)`,padding:`0 12px`,outline:`none`}})',
          '3c: Rh provider name input bound')

    # 3d: Add onClick to Add button
    patch('(0,z.jsxs)(`button`,{style:{height:`32px`,padding:`1px 16px 0 16px`,borderRadius:`var(--radius-md)`,border:`1px solid var(--q-border)`,cursor:`pointer`,backgroundColor:`transparent`,display:`flex`,alignItems:`center`,justifyContent:`center`,gap:`6px`,color:`var(--q-text-secondary)`,fontSize:`14px`,fontFamily:`var(--font-interface)`,flexShrink:0},children:[(0,z.jsx)(Rt,{size:16,style:{flexShrink:0}}),(0,z.jsx)(`span`,{children:`Add`})]})',
          ('(0,z.jsxs)(`button`,{onClick:async()=>{if(!np.trim()||!rpcCall)return;try{let cfg=await rpcCall(`getProvidersConfig`,{});if(!cfg)cfg={providers:{}};if(!cfg.providers)cfg.providers={};cfg.providers[np.trim()]={api:`openai`,enabled:!0,apiKey:``};await rpcCall(`setProvidersConfig`,cfg);n(p=>[...p,{id:np.trim(),name:np.trim(),type:`openai`,apiKeyStatus:`missing`,models:[],enabled:!0}]);snp(``)}catch(e){console.error(`Failed to add provider:`,e)}},style:{height:`32px`,padding:`1px 16px 0 16px`,borderRadius:`var(--radius-md)`,border:`1px solid var(--q-border)`,cursor:`pointer`,backgroundColor:`transparent`,display:`flex`,alignItems:`center`,justifyContent:`center`,gap:`6px`,color:`var(--q-text-secondary)`,fontSize:`14px`,fontFamily:`var(--font-interface)`,flexShrink:0},children:[(0,z.jsx)(Rt,{size:16,style:{flexShrink:0}}),(0,z.jsx)(`span`,{children:`Add`})]})'),
          '3d: Rh Add button onClick')

    # ================================================================
    # PATCH 4: ah (Composer) — @tag filter by chat agents
    # ================================================================

    patch('h=(e.agents||[]).filter(e=>e.id!==`orchestrator`)',
          'h=(e.agents||[]).filter(a=>(e.selectedAgentIds||[]).includes(a.id))',
          '4a: composer agent filter by chatAgentIds')

    # ================================================================
    # PATCH 5: rg (LogPanel) — real logs from sidecar
    # ================================================================

    # 5a: Add bh() and data loading to rg
    old_5a = 'const bodyRef = v.useRef(null);\n\tv.useEffect(() => {\n\t\tif (autoScroll && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;\n\t}, [entries, autoScroll]);'
    new_5a = ('const bodyRef = v.useRef(null);\n'
              '\tconst { call: rgCall, notify: rgNotify, connected: rgConn } = bh();\n'
              '\tv.useEffect(() => {\n'
              '\t\tif (!rgCall) return;\n'
              '\t\trgCall(\'getFullDebugLog\', {}).then(function(r) {\n'
              '\t\t\tif (r && r.log) setEntries(r.log.slice(-500));\n'
              '\t\t}).catch(function() {});\n'
              '\t}, [rgCall]);\n'
              '\tv.useEffect(() => {\n'
              '\t\tif (props.logs && props.logs.length > 0) setEntries(props.logs.slice(-500));\n'
              '\t}, [props.logs]);\n'
              '\tv.useEffect(() => {\n'
              '\t\tif (autoScroll && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;\n'
              '\t}, [entries, autoScroll]);')
    patch(old_5a, new_5a, '5a: rg data loading via bh()')

    # 5b: Clear button — call clearDebugLogFile
    old_5b = 'onClick: () => {\n\t\t\t\t\t\t\t\t\t\tsetEntries([]);\n\t\t\t\t\t\t\t\t\t\tsetShowClear(false);\n\t\t\t\t\t\t\t\t\t},'
    new_5b = 'onClick: async () => {\n\t\t\t\t\t\t\t\t\t\tif (rgCall) { try { await rgCall("clearDebugLogFile", {}); } catch(e) {} }\n\t\t\t\t\t\t\t\t\t\tsetEntries([]);\n\t\t\t\t\t\t\t\t\t\tsetShowClear(false);\n\t\t\t\t\t\t\t\t\t},'
    patch(old_5b, new_5b, '5b: rg clear with clearDebugLogFile')

    # ================================================================
    # Write the patched file
    # ================================================================

    with open(JS_PATH, 'w') as f:
        f.write(js)

    print(f"\nOriginal size: {original_len}")
    print(f"Patched size: {len(js)}")
    print(f"Difference: {len(js) - original_len}")
    print(f"\nAll patches applied:")
    for label, count in patches:
        print(f"  ✓ {label} ({count} replacement(s))")

if __name__ == '__main__':
    main()