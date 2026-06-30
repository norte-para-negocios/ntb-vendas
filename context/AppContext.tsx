import React, { createContext, useContext, useState, useEffect } from 'react';
import { CartItem, Product, Store, Table } from '../types';

interface AppContextType {
  cart: CartItem[];
  addToCart: (product: Product, quantity: number, notes?: string) => void;
  removeFromCart: (product: Product, notes?: string) => void;
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

  const addToCart = (product: Product, quantity: number, notes?: string) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id && item.notes === notes);
      if (existing) {
        // Se a nova quantidade for menor ou igual a zero (caso de decremento), remove o item
        if (existing.quantity + quantity <= 0) {
            return prev.filter(item => !(item.product.id === product.id && item.notes === notes));
        }

        return prev.map(item => 
          (item.product.id === product.id && item.notes === notes)
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }
      // Se for item novo e quantidade positiva
      if (quantity > 0) {
          return [...prev, { product, quantity, notes }];
      }
      return prev;
    });
  };

  const removeFromCart = (product: Product, notes?: string) => {
    setCart(prev => prev.filter(item => !(item.product.id === product.id && item.notes === notes)));
  };

  const clearCart = () => setCart([]);

  return (
    <AppContext.Provider value={{
      cart, addToCart, removeFromCart, clearCart,
      currentStore, setCurrentStore,
      currentTable, setCurrentTable,
      clientName, setClientName,
      isHost, setIsHost
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => useContext(AppContext);