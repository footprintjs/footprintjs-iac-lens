import {createContext,useContext,type ReactNode} from 'react';
import type {SystemSymbolAdapter} from '../../../src/core/system-symbols.ts';

const Symbols=createContext<SystemSymbolAdapter|undefined>(undefined);

/** Consumers supply semantic artwork; Lens supplies only placement, paint and evidence. */
export function SystemSymbolProvider({adapter,children}:{adapter?:SystemSymbolAdapter;children:ReactNode}) {
 return <Symbols.Provider value={adapter}>{children}</Symbols.Provider>;
}

export function useSystemSymbolAdapter():SystemSymbolAdapter|undefined{return useContext(Symbols);}
