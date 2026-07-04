'use client';

import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { CartItem, Product, SelectedOption, Store, Table } from '@/types';

interface AppContextType {
  cart: CartItem[];
  addToCart: (product: Product, quantity: number, notes?: string, selectedOptions?: SelectedOption[]) => void;
  removeFromCart: (product: Product, notes?: string, selectedOptions?: SelectedOption[]) => void;
  clearCart: () => void;
  currentStore: Store | null;
  setCurrentStore: (store: Store | null) => void;
  currentTable: Table | null;
  setCurrentTable: (table: Table | null) => void;
  clientName: string;
  setClientName: (name: string) => void;
  isHost: boolean;
  setIsHost: (isHost: boolean) => void;
}

const AppContext = createContext<AppContextType>({} as AppContextType);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [currentStore, setCurrentStore] = useState<Store | null>(null);
  const [currentTable, setCurrentTable] = useState<Table | null>(null);
  const [clientName, setClientName] = useState<string>('');
  const [isHost, setIsHost] = useState<boolean>(false);

  // Assinatura da seleção de adicionais, pra chave de dedup do carrinho:
  // duas linhas do mesmo produto com adicionais diferentes ("Marguerita +
  // Catupiry" vs "Marguerita + Mussarela") não podem virar a mesma linha.
  // Ordenada pra "Catupiry+Bacon" e "Bacon+Catupiry" (grupo multiple)
  // caírem na mesma assinatura.
  const optionsSignature = (opts?: SelectedOption[]) => (opts || []).map((o) => o.option_id).slice().sort().join('|');
  const sameCartLine = (item: CartItem, product: Product, notes?: string, selectedOptions?: SelectedOption[]) =>
    item.product.id === product.id && item.notes === notes && optionsSignature(item.selectedOptions) === optionsSignature(selectedOptions);

  const addToCart = useCallback((product: Product, quantity: number, notes?: string, selectedOptions?: SelectedOption[]) => {
    setCart((prev) => {
      const existing = prev.find((item) => sameCartLine(item, product, notes, selectedOptions));
      if (existing) {
        if (existing.quantity + quantity <= 0) {
          return prev.filter((item) => !sameCartLine(item, product, notes, selectedOptions));
        }
        return prev.map((item) =>
          sameCartLine(item, product, notes, selectedOptions)
            ? { ...item, quantity: item.quantity + quantity }
            : item,
        );
      }
      if (quantity > 0) return [...prev, { product, quantity, notes, selectedOptions }];
      return prev;
    });
  }, []);

  const removeFromCart = useCallback((product: Product, notes?: string, selectedOptions?: SelectedOption[]) => {
    setCart((prev) =>
      prev.filter((item) => !sameCartLine(item, product, notes, selectedOptions)),
    );
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const value = useMemo<AppContextType>(
    () => ({
      cart, addToCart, removeFromCart, clearCart,
      currentStore, setCurrentStore,
      currentTable, setCurrentTable,
      clientName, setClientName,
      isHost, setIsHost,
    }),
    [
      cart, addToCart, removeFromCart, clearCart,
      currentStore, setCurrentStore,
      currentTable, setCurrentTable,
      clientName, setClientName,
      isHost, setIsHost,
    ],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => useContext(AppContext);
