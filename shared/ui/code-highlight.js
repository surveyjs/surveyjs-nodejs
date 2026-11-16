// Demo only: highlights the Code panel of the step pages. Every platform's server regions are
// registered, so the same file works everywhere. The page loads highlight.js/styles/github-dark.css.
import hljs from 'highlight.js/lib/core';
import csharp from 'highlight.js/lib/languages/csharp';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';

hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('php', php);
hljs.registerLanguage('python', python);
hljs.registerLanguage('typescript', typescript);

for (const block of document.querySelectorAll('pre code[class*="language-"]')) {
    hljs.highlightElement(block);
}
