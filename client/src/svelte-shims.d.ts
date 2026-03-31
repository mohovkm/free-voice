declare module '*.svelte' {
	const component: import('svelte').Component<any>;
	export default component;
}
