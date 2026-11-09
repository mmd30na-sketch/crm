{
  "api": "1",
  "name": "Header UI/UX Refactor",
  "steps": [
    {
      "id": "step_1",
      "command": "python3 -c \"import re; path='/home/mmd30na/Hydra/openclaw/native/state/workspaces/hephaestus/projects/crm/src/App.tsx'; text=open(path).read(); text=text.replace('className={`w-64 bg-slate-900', 'className={`fixed inset-y-0 start-0 z-40 w-64 bg-slate-900 border-e border-slate-800 transition-transform duration-300 transform md:relative md:translate-x-0 ${isSidebarOpen ? \\'translate-x-0\\' : \\'translate-x-full\\'}`'); open(path,'w').write(text)\"",
      "description": "Convert sidebar to breakpoint-aware RTL drawer"
    },
    {
      "id": "step_2",
      "command": "python3 -c \"path='/home/mmd30na/Hydra/openclaw/native/state/workspaces/hephaestus/projects/crm/src/App.tsx'; text=open(path).read(); text=text.replace('className=\\\"flex-1 flex flex-col min-w-0 bg-slate-50\\\"', 'className=\\\"flex-1 flex flex-col min-w-0 bg-slate-50 relative z-0\\\"'); text=text.replace('className=\\\"h-16 px-6 bg-white border-b border-slate-200 flex items-center justify-between\\\"', 'className=\\\"h-16 px-4 md:px-6 bg-white border-b border-slate-200 flex items-center justify-between sticky top-0 z-30 shadow-sm\\\"'); open(path,'w').write(text)\"",
      "description": "Adjust header styling, padding and z-index"
    },
    {
      "id": "approval_pause_responsive",
      "approval": {
        "prompt": "Sidebar converted to mobile drawer, and Header made sticky. Proceed with Icon Controls formatting?",
        "items": ["App.tsx sidebar overlay and header structure updated"]
      }
    },
    {
      "id": "step_3",
      "command": "cd /home/mmd30na/Hydra/openclaw/native/state/workspaces/hephaestus/projects/crm && npx tsx -e \"require('child_process').execSync('npm run build', {stdio: 'inherit'})\"",
      "description": "Verify TypeScript bundle"
    }
  ]
}
