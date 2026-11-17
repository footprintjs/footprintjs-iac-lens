import {Component,lazy,Suspense,type ReactNode} from 'react';
import type {RunWorkspaceProps} from './RunWorkspace.tsx';
const RunWorkspace=lazy(()=>import('./RunWorkspace.tsx'));
class RunBoundary extends Component<{children:ReactNode;onDetails():void},{failed:boolean}> {
 state={failed:false};static getDerivedStateFromError(){return{failed:true};}
 render(){return this.state.failed?<section className="runs-opening" role="alert"><h1>Recent runs could not open</h1><p>The saved recordings are retained.</p><button type="button" onClick={this.props.onDetails}>Open details</button></section>:this.props.children;}
}
/** The run journey and its diagram/recording dependencies stay out of the shell. */
export function RunWorkspaceSlot(props:RunWorkspaceProps){return <RunBoundary onDetails={props.onDetails}><Suspense fallback={<section className="runs-opening" role="status"><h1>Opening runs…</h1></section>}><RunWorkspace {...props}/></Suspense></RunBoundary>;}
