import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';

/* 字体三角色,按需 weight(Design §7.2):
   Chakra Petch 600/700 大标题 | Inter 400/500 正文 | IBM Plex Mono 400/600 数据
   (mono 600:命中计数等需要真粗体,缺权重会被浏览器 faux-bold) */
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles/index.css';

import App from './App.tsx';
import { queryClient, wagmiConfig } from './lib/wagmi.ts';

// WagmiProvider(链/连接器/transport)→ QueryClientProvider(wagmi v2 peer,缓存读链调用)
// → Router → App。顺序:wagmi 在外,query 次之,二者必须包住所有用 wagmi/query hook 的组件。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
